/**
 * 新题型（填空 / 简答）的端到端验证。
 *
 * 前提：题库已被 scripts/import-questions.mjs 导入为 5 道题（单选/多选/判断/填空/简答各一）。
 *   node scripts/import-questions.mjs public/题型验证.csv
 *   node scripts/e2e-types.mjs http://localhost:5213
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

const PORT = 9341;
const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(OUT, '.profile-types')}`,
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 20000);
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

/** 读取当前题的信息 */
const readState = `(() => {
  const t = document.querySelector('.footer-bar .btn--primary');
  const meta = document.querySelector('.quiz-meta__top span');
  return {
    index: document.querySelector('.stem__index') ? document.querySelector('.stem__index').innerText : null,
    type: document.querySelector('.stem__type') ? document.querySelector('.stem__type').innerText : null,
    stem: document.querySelector('.stem__text') ? document.querySelector('.stem__text').innerText.slice(0, 24) : null,
    btn: t ? t.innerText.trim() : null,
    btnDisabled: t ? t.disabled : null,
    hasInput: Boolean(document.querySelector('.fill-input')),
    hasTextarea: Boolean(document.querySelector('.short-input')),
    options: document.querySelectorAll('.option').length,
    feedback: document.querySelector('.feedback') ? document.querySelector('.feedback').innerText.slice(0, 60) : null,
    answered: meta ? meta.innerText : null,
  };
})()`;

async function next() {
  await evaluate(`(() => {
    const t = document.querySelector('.footer-bar .btn--primary');
    if (t && t.innerText.includes('下一题')) t.click();
  })()`);
  await sleep(400);
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
  // 关掉「自动下一题」，让每题都停住便于断言
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('quizapp.v1.settings', JSON.stringify({ autoNext: false, shuffleOptions: false })); } catch (e) {}`,
  });

  console.log('\n[1] 章节练习覆盖全部新题型');
  await send('Page.navigate', { url: `${BASE}/#/quiz/chapter/demo` });
  await sleep(1800);

  const first = await evaluate(readState);
  check('章节练习能进入（新题库章节）', Boolean(first.stem), JSON.stringify(first));
  console.log(`     第 1 题: ${first.type} / ${first.stem}`);

  // 逐题过一遍：填空题与简答题做针对性断言，其余题只前进（不做答，避免干扰）
  let sawFill = false;
  let sawShort = false;
  const handled = new Set();

  for (let step = 0; step < 24; step += 1) {
    const s = await evaluate(readState);
    if (!s.index || !s.type) break;
    const key = `${s.index}|${s.type}`;
    const firstVisit = !handled.has(key);
    handled.add(key);
    console.log(`     第 ${step + 1} 步: ${s.type} / ${s.stem}${firstVisit ? '' : '（已处理过，仅前进）'}`);

    const isLast = (s.btn || '').includes('查看成绩');

    if (firstVisit && s.type === '填空题') {
      sawFill = true;
      check('填空题渲染输入框', s.hasInput, JSON.stringify(s));
      check('填空题未作答时确认按钮禁用', s.btnDisabled === true, `disabled=${s.btnDisabled}`);

      await evaluate(`(() => {
        const i = document.querySelector('.fill-input');
        i.value = '随便写点错的';
        i.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await sleep(250);
      const enabled = await evaluate(readState);
      check('填空题填写后确认按钮可用', enabled.btnDisabled === false, `disabled=${enabled.btnDisabled}`);
      await shot('20-fill-typing');

      await evaluate(`document.querySelector('.footer-bar .btn--primary').click()`);
      await sleep(500);
      const judged = await evaluate(readState);
      check(
        '填空题错误答案判为错并给出正确答案',
        Boolean(judged.feedback && judged.feedback.includes('回答错误')),
        judged.feedback || '无反馈'
      );
      check('填空题解析里显示正确答案', Boolean(judged.feedback && judged.feedback.includes('预防为主')));
    }

    if (firstVisit && s.type === '简答题') {
      sawShort = true;
      check('简答题渲染文本域', s.hasTextarea, JSON.stringify(s));
      await evaluate(`(() => {
        const a = document.querySelector('.short-input');
        a.value = '先报警，再在保证自身安全的前提下初期扑救，然后断电断气、有序疏散到集合点清点人数。';
        a.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await sleep(250);
      await shot('21-short-typing');
      await evaluate(`document.querySelector('.footer-bar .btn--primary').click()`);
      await sleep(500);
      const judged = await evaluate(readState);
      check('简答题显示待自评', Boolean(judged.feedback && judged.feedback.includes('待自评')), judged.feedback || '无反馈');
      check('简答题展示参考答案', Boolean(judged.feedback && judged.feedback.includes('参考答案')));
      check('简答题不显示对错', Boolean(judged.feedback && !judged.feedback.includes('回答错误')), judged.feedback || '');
      await shot('22-short-feedback');
      handled.add(`${judged.index}|${judged.type}`);
      void judged;
    }

    if (isLast) break;

    // 前进：已是「下一题」就直接点；多选/填空/简答需要先确认再点下一题
    await evaluate(`(() => {
      const t = document.querySelector('.footer-bar .btn--primary');
      if (!t) return 'no-btn';
      if (t.innerText.includes('下一题')) { t.click(); return 'next'; }
      if (t.innerText.includes('确认答案') && !t.disabled) { t.click(); return 'confirm'; }
      if (t.innerText.includes('确认答案') && t.disabled) {
        const o = document.querySelector('.option');
        if (o) { o.click(); return 'pick'; }
      }
      return 'stuck:' + t.innerText.trim();
    })()`);
    await sleep(420);

    const after = await evaluate(readState);
    if (after.index === s.index && after.btn === s.btn) {
      // 同一题且按钮没变，说明卡住了，换一种方式再试一次
      await evaluate(`(() => {
        const t = document.querySelector('.footer-bar .btn--primary');
        const n = [...document.querySelectorAll('.footer-bar .btn')].find((b) => b.innerText.includes('下一题'));
        if (n) n.click();
        else if (t && !t.disabled) t.click();
      })()`);
      await sleep(420);
    }
  }

  check('题库包含填空题并已练习', sawFill);
  check('题库包含简答题并已练习', sawShort);

  console.log('\n[2] 交卷判分（简答题不拉低总分）');
  // 把能答的都答对：重开一轮，逐一作答
  await evaluate(`location.hash = '#/quiz/chapter/demo'`);
  await sleep(1500);

  for (let step = 0; step < 12; step += 1) {
    const s = await evaluate(readState);
    if (!s.index) break;
    const isLast = (s.btn || '').includes('查看成绩');

    if (s.type === '填空题') {
      await evaluate(`(() => {
        const i = document.querySelector('.fill-input');
        i.value = '预防为主';
        i.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('.footer-bar .btn--primary').click();
      })()`);
    } else if (s.type === '简答题') {
      await evaluate(`(() => {
        const a = document.querySelector('.short-input');
        a.value = '报警、初期扑救、断电断气、疏散、清点。';
        a.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('.footer-bar .btn--primary').click();
      })()`);
    } else if (s.type === '多选题') {
      await evaluate(`(() => {
        // 全选（示例多选题答案就是 ABC）
        document.querySelectorAll('.option').forEach((o) => o.click());
        const t = document.querySelector('.footer-bar .btn--primary');
        if (t && t.innerText.includes('确认答案')) t.click();
      })()`);
    } else if (s.type === '单选题' || s.type === '判断题') {
      await evaluate(`(() => {
        const target = [...document.querySelectorAll('.option')].find(o => o.innerText.includes('正确佩戴劳动防护用品') || o.innerText.includes('错误'));
        (target || document.querySelector('.option')).click();
      })()`);
    } else if (s.type === '判断题') {
      await evaluate(`document.querySelector('.option').click()`);
    }

    await sleep(450);
    if (isLast) break;
    await next();
  }

  const lastState = await evaluate(readState);
  if ((lastState.btn || '').includes('查看成绩')) {
    await evaluate(`document.querySelector('.footer-bar .btn--primary').click()`);
    await sleep(1000);
  }

  const result = await evaluate(`({
    hash: location.hash,
    score: (document.querySelector('.score-board__value') || {}).innerText || '',
    text: document.body.innerText,
    pendingTags: [...document.querySelectorAll('.analysis-item')].filter(i => i.innerText.includes('待自评')).length,
  })`);
  check('进入结果页', /result\//.test(result.hash), result.hash);
  check('结果页有得分', /分/.test(result.score), result.score.replace(/\n/g, ''));
  check('结果页标记简答题为待自评', result.pendingTags >= 1, `pendingTags=${result.pendingTags}`);
  check('结果页展示参考答案', result.text.includes('参考答案'));
  await shot('23-result-with-new-types');

  console.log('\n[3] 控制台错误');
  const real = consoleErrors.filter((e) => !/favicon|manifest/i.test(e));
  check('页面无 JS 报错', real.length === 0, real.slice(0, 3).join(' | '));

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
