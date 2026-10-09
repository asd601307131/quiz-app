/**
 * 成考题库专用验证：确认新题库在真实浏览器里可正常练习。
 *
 *   node scripts/e2e-exam.mjs http://localhost:5213
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = process.argv[2] || 'http://localhost:5213';
const OUT = path.join(ROOT, 'screenshots');

const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!browserPath) {
  console.error('未找到 Edge');
  process.exit(2);
}

const PORT = 9343;
const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(OUT, '.profile-exam')}`,
  '--window-size=390,844', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let msgId = 0; const pending = new Map(); let ws;
const consoleErrors = [];

function send(method, params = {}) {
  const id = (msgId += 1);
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 25000);
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'));
  console.log(`  📸 screenshots\\${name}.png`);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
}

async function main() {
  let target;
  for (let i = 0; i < 40; i += 1) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
      if (target) break;
    } catch (err) { /* waiting */ }
    await sleep(250);
  }

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push((m.params.args || []).map((a) => a.value || a.description).join(' '));
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.clear(); localStorage.setItem('quizapp.v1.settings', JSON.stringify({ autoNext: false, shuffleOptions: false })); } catch (e) {}`,
  });

  console.log('\n[1] 首页与章节规模');
  await send('Page.navigate', { url: `${BASE}/#/home` });
  await sleep(2000);
  const home = await evaluate(`({
    text: document.body.innerText,
    chapters: document.querySelectorAll('.list__item').length,
  })`);
  check('首页渲染成功', home.text.includes('题库板块') && home.text.includes('模拟考试'));
  check('首页展示成考章节', home.text.includes('政治') || home.text.includes('真题') || home.text.includes('英语'));
  await shot('30-home-exam-bank');

  await send('Page.navigate', { url: `${BASE}/#/chapters` });
  await sleep(1500);
  const chapters = await evaluate(`({
    count: document.querySelectorAll('.list__item').length,
    rows: document.querySelectorAll('.chapter-row__icon').length,
    text: document.body.innerText,
  })`);
  check('章节列表加载全部章节', chapters.count >= 20 || chapters.rows >= 20, `列表项=${chapters.count} 章节图标=${chapters.rows}`);
  await shot('31-chapters-exam-bank');

  console.log('\n[2] 政治真题练习（选择题）');
  await send('Page.navigate', { url: `${BASE}/#/quiz/chapter/real-2024-choice` });
  await sleep(1800);
  const q1 = await evaluate(`(() => {
    const stem = document.querySelector('.stem__text');
    return {
      title: document.querySelector('.header__title') ? document.querySelector('.header__title').innerText : null,
      stem: stem ? stem.innerText : null,
      options: [...document.querySelectorAll('.option')].map(o => o.innerText.replace(/\\n/g,' ')),
      type: document.querySelector('.stem__type') ? document.querySelector('.stem__type').innerText : null,
    };
  })()`);
  check('进入 2024 真题选择题章节', Boolean(q1.stem), JSON.stringify(q1).slice(0, 120));
  check('真题题干可读', Boolean(q1.stem && q1.stem.length > 5), q1.stem || '');
  check('四个选项齐全', q1.options.length === 4, `选项数=${q1.options.length}`);
  await shot('32-real-exam-question');

  // 作答并看解析
  await evaluate(`document.querySelector('.option').click()`);
  await sleep(900);
  const afterPick = await evaluate(`(() => {
    const fb = document.querySelector('.feedback');
    return { feedback: fb ? fb.innerText : null, right: document.querySelectorAll('.option--right').length };
  })()`);
  check('作答后显示解析', Boolean(afterPick.feedback));
  check('标出正确答案', afterPick.right >= 1, `标出 ${afterPick.right} 个`);
  await shot('33-real-exam-feedback');

  console.log('\n[3] 政治辨析题（判断正误 + 说明理由）');
  await send('Page.navigate', { url: `${BASE}/#/quiz/chapter/subj-bx` });
  await sleep(1800);
  // 辨析题专项里既有「判断正误」（判断题，2 个选项）也有「说明理由」（简答题），逐题作答推进
  let sawJudge = false;
  let sawReason = false;
  const visited = new Set();
  for (let i = 0; i < 26; i += 1) {
    const s = await evaluate(`({
      idx: document.querySelector('.stem__index') ? document.querySelector('.stem__index').innerText : null,
      type: document.querySelector('.stem__type') ? document.querySelector('.stem__type').innerText : null,
      options: [...document.querySelectorAll('.option')].map(o => o.innerText.replace(/\\n/g,' ')),
      textarea: Boolean(document.querySelector('.short-input')),
      btn: document.querySelector('.footer-bar .btn--primary') ? document.querySelector('.footer-bar .btn--primary').innerText.trim() : null,
      btnDisabled: document.querySelector('.footer-bar .btn--primary') ? document.querySelector('.footer-bar .btn--primary').disabled : null,
      revealed: Boolean(document.querySelector('.feedback')),
    })`);
    if (!s.idx) break;

    // 判断题（引擎归一化为单选，标签显示「单选题」，选项为 正确/错误）
    const isJudgeLike = s.options.length === 2 && s.options[0].includes('正确') && s.options[1].includes('错误');
    if (isJudgeLike) sawJudge = true;
    if (s.textarea) sawReason = true;
    if (sawJudge && sawReason) break;

    const key = `${s.idx}|${s.type}|${s.options.length}`;
    const revisited = visited.has(key);
    visited.add(key);

    // 一步：需要作答就作答，需要翻页就翻页
    await evaluate(`(() => {
      const t = document.querySelector('.footer-bar .btn--primary');
      if (!t) return 'no-btn';
      // 已经揭晓解析 → 翻页
      if (document.querySelector('.feedback') && t.innerText.includes('下一题')) { t.click(); return 'next'; }
      if (t.innerText.includes('下一题')) { t.click(); return 'next'; }
      // 文本题：先填字再确认
      const area = document.querySelector('.short-input');
      if (area && !area.disabled) {
        area.value = '测试作答，用于推进到下一题。';
        area.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // 选项题：选第一个选项（判断题/单选会自动揭晓；多选需再点确认）
      const opt = document.querySelector('.option');
      if (opt && !opt.disabled) { opt.click(); return 'pick'; }
      const t2 = document.querySelector('.footer-bar .btn--primary');
      if (t2 && !t2.disabled) { t2.click(); return 'confirm'; }
      return 'stuck';
    })()`);
    await sleep(480);

    // 兜底：如果两轮都停在同一题，强制点「下一题」
    if (revisited) {
      await evaluate(`(() => {
        const n = [...document.querySelectorAll('.footer-bar .btn')].find((b) => b.innerText.includes('下一题'));
        if (n) n.click();
      })()`);
      await sleep(400);
    }
  }
  check('辨析题包含「判断正误」题型（正确/错误两个选项）', sawJudge);
  check('辨析题包含「说明理由」题型（文本框）', sawReason);
  await shot('34-bianxi-question');

  console.log('\n[4] 简答与论述题（主观题）');
  await send('Page.navigate', { url: `${BASE}/#/quiz/chapter/real-2024-essay` });
  await sleep(1800);
  const essay = await evaluate(`({
    type: document.querySelector('.stem__type') ? document.querySelector('.stem__type').innerText : null,
    stem: document.querySelector('.stem__text') ? document.querySelector('.stem__text').innerText.slice(0, 60) : null,
    hasTextarea: Boolean(document.querySelector('.short-input')),
  })`);
  check('论述题可进入', Boolean(essay.stem), JSON.stringify(essay));
  check('论述题提供作答文本框', essay.hasTextarea);
  await shot('35-essay-question');

  if (essay.hasTextarea) {
    await evaluate(`(() => {
      const a = document.querySelector('.short-input');
      a.value = '第一，文化对社会发展起促进或延缓作用；第二，文化提供思想指引；第三，文化提供精神动力；第四，文化提供凝聚力量。';
      a.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(300);
    await evaluate(`document.querySelector('.footer-bar .btn--primary').click()`);
    await sleep(700);
    const fb = await evaluate(`document.querySelector('.feedback') ? document.querySelector('.feedback').innerText.slice(0, 120) : null`);
    check('论述题显示参考答案', Boolean(fb && fb.includes('参考答案')), fb || '无反馈');

    // 参考答案要点 + 「我已掌握」自评
    const essayUi = await evaluate(`({
      points: document.querySelectorAll('.points__item').length,
      pointsTitle: document.querySelector('.points__title') ? document.querySelector('.points__title').innerText : null,
      masteryBtn: Boolean(document.querySelector('.mastery-done')) || Boolean([...document.querySelectorAll('.mastery-row .btn')].find((b) => b.innerText.includes('掌握'))),
    })`);
    check('参考答案按要点逐条展示', essayUi.points >= 2, `要点数=${essayUi.points} ${essayUi.pointsTitle || ''}`);
    check('提供「我已掌握」自评入口', essayUi.masteryBtn);
    await shot('41-essay-points');

    // 点击「我已掌握」并确认进度被记录
    const beforeMastered = await evaluate(`(async () => {
      const s = await import('./src/core/store.js');
      return s.getMasteredIds().length;
    })()`);
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('.mastery-row .btn')].find((x) => x.innerText.includes('掌握'));
      if (b) b.click();
    })()`);
    await sleep(600);
    const afterMastered = await evaluate(`(async () => {
      const s = await import('./src/core/store.js');
      return s.getMasteredIds().length;
    })()`);
    check('点击后掌握进度 +1', afterMastered === beforeMastered + 1, `${beforeMastered} -> ${afterMastered}`);
    await shot('42-mastery-marked');
    await shot('36-essay-feedback');
  }

  console.log('\n[5] 英语考情题');
  await send('Page.navigate', { url: `${BASE}/#/quiz/chapter/en-format` });
  await sleep(1600);
  const en = await evaluate(`({
    stem: document.querySelector('.stem__text') ? document.querySelector('.stem__text').innerText.slice(0, 50) : null,
    options: document.querySelectorAll('.option').length,
  })`);
  check('英语章节可进入', Boolean(en.stem), JSON.stringify(en));
  await shot('37-english-question');

  console.log('\n[6] 随机组卷（多章节混合）');
  await send('Page.navigate', { url: `${BASE}/#/setup/practice` });
  await sleep(1400);
  const setup = await evaluate(`document.body.innerText.slice(0, 120)`);
  check('组卷设置页正常', setup.includes('选择章节') || setup.includes('可抽题'), setup.slice(0, 60));
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.footer-bar .btn')].find(b => b.innerText.includes('开始练习'));
    if (btn) btn.click();
  })()`);
  await sleep(1600);
  const mixed = await evaluate(`({
    hash: location.hash,
    stem: document.querySelector('.stem__text') ? document.querySelector('.stem__text').innerText.slice(0, 40) : null,
  })`);
  check('随机组卷可开始答题', Boolean(mixed.stem), JSON.stringify(mixed));
  await shot('38-mixed-paper');

  console.log('\n[7] 控制台错误');
  const real = consoleErrors.filter((e) => !/favicon|manifest/i.test(e));
  check('页面无 JS 报错', real.length === 0, real.slice(0, 2).join(' | '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n结果: ${results.length - failed.length} 通过, ${failed.length} 失败`);
  if (failed.length) failed.forEach((f) => console.log(`  - ${f.name}`));
  console.log('');

  ws.close();
  child.kill();
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('验证异常:', err);
  try { child.kill(); } catch (e) { /* ignore */ }
  process.exit(1);
});
