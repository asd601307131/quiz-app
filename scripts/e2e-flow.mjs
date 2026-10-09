/**
 * 答题流程行为验证：即时反馈、解析入口、时长估算、限时交卷。
 *
 *   node scripts/e2e-flow.mjs http://localhost:5213
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

const PORT = 9357;
const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(OUT, '.profile-flow')}`,
  '--window-size=390,844', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let msgId = 0; const pending = new Map(); let ws;
const errors = [];

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

async function goto(hash, wait = 1200) {
  await evaluate(`location.hash = ${JSON.stringify(hash)};`);
  await sleep(wait);
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
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'try { localStorage.clear(); } catch (e) {}' });
  await send('Page.navigate', { url: `${BASE}/#/home` });
  await sleep(2000);

  /* ---------------- 1. 默认不自动跳题 ---------------- */
  console.log('\n[1] 练习模式：作答后必须停在本页，能看答案与解析');
  await goto('#/chapter/p1-1');
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('.btn')].find((x) => x.innerText.includes('开始顺序练习'));
    if (b) b.click();
  })()`);
  await sleep(1400);

  const firstStem = await evaluate(`document.querySelector('.stem__text') ? document.querySelector('.stem__text').innerText : ''`);
  const indexBefore = await evaluate(`document.querySelector('.header__extra') ? document.querySelector('.header__extra').innerText : ''`);

  // 选第一个选项（选错也无所谓，重点是页面不能自己跳走）
  await evaluate(`(() => {
    const opt = document.querySelector('.option');
    if (opt) opt.click();
  })()`);
  await sleep(2200); // 超过原先 650ms 的自动跳转延时

  const afterAnswer = await evaluate(`({
    stem: document.querySelector('.stem__text') ? document.querySelector('.stem__text').innerText : '',
    index: document.querySelector('.header__extra') ? document.querySelector('.header__extra').innerText : '',
    hasFeedback: Boolean(document.querySelector('.feedback')),
    feedbackText: document.querySelector('.feedback') ? document.querySelector('.feedback').innerText.slice(0, 60) : '',
    hasAnalysis: (document.querySelector('.feedback') || {}).innerText
      ? document.querySelector('.feedback').innerText.includes('解析')
      : false,
  })`);

  check('作答后仍停留在同一题（不自动跳转）',
    afterAnswer.stem === firstStem && afterAnswer.index === indexBefore,
    `题号 ${indexBefore}→${afterAnswer.index}`);
  check('作答后立即显示判定结果', afterAnswer.hasFeedback, afterAnswer.feedbackText);
  check('判定结果里包含答案解析', afterAnswer.hasAnalysis, afterAnswer.feedbackText);
  await shot('80-practice-stay');

  /* ---------------- 2. 文字题「看解析」入口 ---------------- */
  console.log('\n[2] 文字题：不写答案也能直接看参考解析');
  await goto('#/chapter/subj-jd');
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('.btn')].find((x) => x.innerText.includes('开始顺序练习'));
    if (b) b.click();
  })()`);
  await sleep(1500);

  const beforeReveal = await evaluate(`({
    isText: Boolean(document.querySelector('.short-input, .fill-input')),
    hasRevealBtn: [...document.querySelectorAll('.footer-bar .btn')].some((b) => b.innerText.includes('看解析')),
    hasConfirm: [...document.querySelectorAll('.footer-bar .btn')].some((b) => b.innerText.includes('确认答案')),
    options: document.querySelectorAll('.option').length,
  })`);
  check('进入文字题（无选项、有输入框）', beforeReveal.isText && beforeReveal.options === 0, JSON.stringify(beforeReveal));
  check('文字题提供「看解析」按钮', beforeReveal.hasRevealBtn);
  check('文字题保留「确认答案」按钮（确认键默认禁用）',
    beforeReveal.hasConfirm && (await evaluate(`[...document.querySelectorAll('.footer-bar .btn')].find((b) => b.innerText.includes('确认答案')).disabled`)) === true);

  // 什么都不写，直接点「看解析」
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('.footer-bar .btn')].find((x) => x.innerText.includes('看解析'));
    if (b) b.click();
  })()`);
  await sleep(1000);

  const afterReveal = await evaluate(`({
    feedbackText: document.querySelector('.feedback') ? document.querySelector('.feedback').innerText : '',
    hasPoints: document.querySelectorAll('.points__item').length,
    hasMastery: Boolean(document.querySelector('.mastery-done')) || [...document.querySelectorAll('.mastery-row .btn')].length > 0,
  })`);
  check('未作答也能看到参考答案', afterReveal.feedbackText.includes('参考答案') || afterReveal.hasPoints > 0,
    afterReveal.feedbackText.slice(0, 50));
  check('明确标注本题未作答', afterReveal.feedbackText.includes('未作答'), afterReveal.feedbackText.slice(0, 40));
  check('参考答案按要点展示', afterReveal.hasPoints >= 2, `要点数=${afterReveal.hasPoints}`);
  check('提供「我已掌握」自评入口', afterReveal.hasMastery);
  await shot('81-reveal-without-answer');

  /* ---------------- 3. 时长估算 ---------------- */
  console.log('\n[3] 按题型数量估算整套时长');
  await goto('#/setup/exam');
  const setup = await evaluate(`({
    hint: document.querySelector('.form-field__hint') ? document.querySelector('.form-field__hint').innerText : '',
    hasApplyBtn: [...document.querySelectorAll('.btn')].some((b) => b.innerText.includes('用建议时长')),
    duration: document.querySelector('.duration-row input') ? document.querySelector('.duration-row input').value : null,
  })`);
  check('组卷页显示建议时长', /建议.*分钟/.test(setup.hint), setup.hint);
  check('提供「用建议时长」按钮', setup.hasApplyBtn);

  // 点「用建议时长」后输入框应被填入建议值
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('.btn')].find((x) => x.innerText.includes('用建议时长'));
    if (b) b.click();
  })()`);
  await sleep(700);
  const applied = await evaluate(`({
    duration: document.querySelector('.duration-row input').value,
    hint: document.querySelector('.form-field__hint').innerText,
  })`);
  check('采用后时长被填入建议值', Number(applied.duration) > 0 && applied.hint.includes('已采用'),
    `${applied.duration} 分钟 · ${applied.hint.slice(0, 40)}`);

  // 章节练习页也应显示预计用时
  await goto('#/setup/practice');
  const practiceSetup = await evaluate(`document.querySelector('.form-field__hint') ? document.querySelector('.form-field__hint').innerText : ''`);
  check('练习组卷页显示预计用时', /估算约需\s*\d+\s*分钟/.test(practiceSetup), practiceSetup);
  await shot('82-duration-estimate');

  /* ---------------- 4. 练习页顶部显示本套估算 ---------------- */
  await goto('#/quiz/chapter/p1-1');
  await sleep(1200);
  const quizMeta = await evaluate(`document.querySelector('.quiz-meta__sub') ? document.querySelector('.quiz-meta__sub').innerText : ''`);
  check('答题页显示本套估算用时', /按题型估算约需\s*\d+\s*分钟/.test(quizMeta), quizMeta);

  /* ---------------- 5. 考试模式限时与交卷 ---------------- */
  console.log('\n[4] 考试模式：倒计时与到点自动交卷');
  await goto('#/quiz/exam?n=3&t=1');
  await sleep(1500);
  // 稍等，避免刚进入时仍渲染着上一页的底部按钮
  await sleep(600);
  const examInit = await evaluate(`({
    timer: document.querySelector('[data-role="timer"]') ? document.querySelector('[data-role="timer"]').innerText : null,
    nextBtn: [...document.querySelectorAll('.footer-bar .btn')].some((b) => b.innerText.includes('下一题')),
    noRevealBtn: ![...document.querySelectorAll('.footer-bar .btn')].some((b) => b.innerText.includes('看解析')),
    options: document.querySelectorAll('.option').length,
  })`);
  check('考试模式显示倒计时', Boolean(examInit.timer), examInit.timer || '无计时器');
  check('考试模式首屏为「下一题」（交卷在最后一题）', examInit.nextBtn);
  check('考试模式不显示即时解析入口', examInit.noRevealBtn);
  check('考试模式选项可作答（不即时判分）', examInit.options >= 2, `选项数=${examInit.options}`);

  // 跳到最后一题应出现交卷
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('.footer-bar .btn')].find((x) => x.innerText.includes('下一题'));
    if (b) b.click();
  })()`);
  await sleep(500);
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('.footer-bar .btn')].find((x) => x.innerText.includes('下一题'));
    if (b) b.click();
  })()`);
  await sleep(700);
  const lastQ = await evaluate(`[...document.querySelectorAll('.footer-bar .btn')].map((b) => b.innerText.trim())`);
  check('最后一题出现「交卷」按钮', lastQ.some((t) => t.includes('交卷')), lastQ.join(' | '));

  // 等待倒计时归零，应自动交卷进入结果页
  console.log('    等待 60 秒倒计时结束（自动交卷）...');
  for (let i = 0; i < 40; i += 1) {
    await sleep(2000);
    const hash = await evaluate('location.hash');
    if (hash.includes('result')) break;
  }
  const auto = await evaluate(`({ hash: location.hash, text: document.body.innerText.slice(0, 60) })`);
  check('倒计时结束后自动交卷', auto.hash.includes('result'), auto.hash);
  check('结果页显示得分', /得分|分/.test(auto.text), auto.text.replace(/\n/g, ' ').slice(0, 40));
  await shot('83-exam-autosubmit');

  console.log('\n[5] 控制台错误');
  const real = errors.filter((e) => !/favicon|manifest/i.test(e));
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
