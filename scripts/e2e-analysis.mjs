/**
 * 解析页 / 错题跳转 / 答题卡跳转 的验收测试
 * 逐条对应用户提出的 9 条验收标准。
 *
 *   node scripts/e2e-analysis.mjs http://localhost:5213
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
if (!browserPath) { console.error('未找到 Edge'); process.exit(2); }

const PORT = 9373;
const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(OUT, '.profile-analysis')}`,
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
async function ev(expression) {
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

/** 读取解析区里选项的颜色与标签，用于校验颜色规则 */
const READ_OPTIONS = `(() => {
  const scope = document.querySelector('.options--analysis');
  if (!scope) return { count: 0 };
  const items = [...scope.querySelectorAll('.option')].map((o) => {
    const textEl = o.querySelector('.option__text, span:nth-child(2)');
    const cs = textEl ? getComputedStyle(textEl) : null;
    return {
      letter: (o.querySelector('.option__key') || {}).innerText || '',
      text: textEl ? textEl.innerText.slice(0, 24) : '',
      color: cs ? cs.color : '',
      bg: getComputedStyle(o).backgroundColor,
      labels: [...o.querySelectorAll('.option__labels .tag')].map((t) => t.innerText.trim()),
    };
  });
  return { count: items.length, items };
})()`;

/** 把 rgb 颜色粗略归类 */
function classify(color) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color || '');
  if (!m) return 'unknown';
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (g > r + 20 && g > b + 20) return 'green';
  if (r > g + 20 && r > b + 20) return 'red';
  if (r < 90 && g < 100 && b < 110) return 'default-dark'; // 深色正文
  return 'default';
}

async function main() {
  let target;
  for (let i = 0; i < 40; i += 1) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); if (target) break; } catch {}
    await sleep(250);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push((m.params.args || []).map((a) => a.value || a.description).join(' '));
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{localStorage.clear();localStorage.setItem("quizapp.v1.settings",JSON.stringify({autoNext:false,shuffleOptions:false}))}catch(e){}' });
  await send('Page.navigate', { url: `${BASE}/#/home` });
  await sleep(2200);

  /* ---------- 验收 1/2/3：练习即时反馈的选项与颜色 ---------- */
  console.log('\n[1] 练习作答后：解析必须完整显示四个选项 + 颜色 + 标签');
  await ev(`location.hash = '#/chapter/p1-1';`); await sleep(1200);
  await ev(`(() => { const b=[...document.querySelectorAll('.btn')].find(x=>x.innerText.includes('开始顺序练习')); if(b)b.click(); })()`);
  await sleep(1400);
  // 故意选错：取第 1 个选项
  await ev(`document.querySelector('.option').click()`);
  await sleep(1000);
  const p1 = await ev(READ_OPTIONS);
  check('解析区列出 4 个选项', p1.count === 4, `实际 ${p1.count}`);
  const rightItem = (p1.items || []).find((x) => x.labels.includes('正确答案'));
  const wrongItem = (p1.items || []).find((x) => x.labels.includes('选错'));
  check('标出「正确答案」选项', Boolean(rightItem), rightItem ? `${rightItem.letter}.${rightItem.text}` : '未找到');
  check('正确答案文字为绿色', rightItem && classify(rightItem.color) === 'green', rightItem ? rightItem.color : '');
  check('选错的选项标出「选错」并为红色', wrongItem && classify(wrongItem.color) === 'red', wrongItem ? `${wrongItem.letter} ${wrongItem.color}` : '未找到');
  const untouched = (p1.items || []).filter((x) => !x.labels.length);
  check('未选且非正确答案的选项保持默认颜色',
    untouched.length > 0 && untouched.every((x) => classify(x.color) !== 'green' && classify(x.color) !== 'red'),
    untouched.map((x) => `${x.letter}:${classify(x.color)}`).join(' '));
  const noBlockColor = (p1.items || []).every((x) => {
    const bg = classify(x.bg);
    return bg === 'unknown' || /rgba?\(0,\s*0,\s*0,\s*0\)/.test(x.bg) || x.bg === 'transparent';
  });
  check('选项没有整块背景变色（背景透明）', noBlockColor, (p1.items || []).map((x) => x.bg).join(' '));
  await shot('90-practice-analysis-options');

  /* ---------- 答对时：绿色 + 两个标签 ---------- */
  console.log('\n[2] 答对时：绿色 + 「正确答案」「你的选择」双标签');
  await ev(`location.hash = '#/quiz/chapter/p1-1';`); await sleep(1400);
  // 从**已渲染的题目卡**里读正确答案（题目对象或页面文字都可以）：
  // 更稳的做法是先点一遍，再从解析里读回正确答案，然后重进答对
  await ev(`location.hash = '#/chapter/p1-1';`); await sleep(1200);
  await ev(`(() => { const b=[...document.querySelectorAll('.btn')].find(x=>x.innerText.includes('开始顺序练习')); if(b)b.click(); })()`);
  await sleep(1400);
  // 先用「看解析」拿到正确答案字母（判断题位），再刷新重来答对
  const correctLetter = await ev(`(async () => {
    const e = await import('./src/core/engine.js');
    const d = await import('./src/data/questions.js');
    // 通过 DOM 上的题干反查题目，避免依赖 state 模块路径
    const stem = document.querySelector('.stem__text').innerText.trim();
    const q = d.QUESTIONS.find((x) => x.stem.trim() === stem);
    return q ? e.normalizeAnswer(q.answer)[0] : null;
  })()`).catch(() => null);

  if (correctLetter) {
    await ev(`(() => {
      const opts = [...document.querySelectorAll('.options .option')];
      const target = opts.find((o) => (o.querySelector('.option__key') || {}).innerText === '${correctLetter}');
      if (target) target.click();
    })()`);
    await sleep(1100);
  }
  const p2 = await ev(READ_OPTIONS);
  const both = (p2.items || []).find((x) => x.labels.includes('正确答案') && x.labels.includes('你的选择'));
  check('答对时同一选项带「正确答案」「你的选择」', Boolean(both),
    `正确答案字母=${correctLetter}；标签分布=${JSON.stringify((p2.items || []).map((x) => x.labels))}`);
  check('答对时该选项文字为绿色', both && classify(both.color) === 'green', both ? both.color : '');

  /* ---------- 验收 4：错题本点击进入该题解析 ---------- */
  console.log('\n[3] 错题本点击某题 → 直接进入该题解析（不是答题卡）');
  // 先制造错题：逐题故意选错前 3 题
  await ev(`location.hash = '#/chapter/p1-1';`); await sleep(1200);
  await ev(`(() => { const b=[...document.querySelectorAll('.btn')].find(x=>x.innerText.includes('开始顺序练习')); if(b)b.click(); })()`);
  await sleep(1400);
  for (let i = 0; i < 3; i += 1) {
    const picked = await ev(`(() => {
      const opts = [...document.querySelectorAll('.options .option')];
      if (!opts.length) return false;
      opts[opts.length - 1].click();
      return true;
    })()`);
    if (!picked) break;
    await sleep(900);
    const canNext = await ev(`(() => { const b=[...document.querySelectorAll('.footer-bar .btn')].find(x=>x.innerText.includes('下一题')); if(b){b.click();return true;} return false; })()`);
    if (!canNext) break;
    await sleep(900);
  }
  await ev(`location.hash = '#/wrong';`); await sleep(1400);
  const wrongN = await ev(`document.querySelectorAll('.list__item').length`);
  check('错题本有错题可点', wrongN > 0, `${wrongN} 条`);
  await ev(`document.querySelectorAll('.list__item')[0].click()`);
  await sleep(1300);
  const r1 = await ev(`({
    hash: location.hash,
    title: (document.querySelector('.header__title')||{}).innerText || '',
    isSheet: Boolean(document.querySelector('.sheet-grid')),
    optionCount: document.querySelectorAll('.options--analysis .option').length,
    optionLabels: [...document.querySelectorAll('.options--analysis .option__labels .tag')].map(t=>t.innerText.trim()),
  })`);
  check('跳转到该题解析页（非答题卡）', r1.hash.includes('review/') && !r1.isSheet, r1.hash);
  check('解析页显示 4 个选项', r1.optionCount === 4, `实际 ${r1.optionCount}`);
  check('解析页带颜色标签', r1.optionLabels.length > 0, r1.optionLabels.join('/'));
  await shot('91-wrongbook-question-detail');

  /* ---------- 验收 6：返回回到错题本 ---------- */
  await ev(`(() => { const b=document.querySelector('.header__back'); if(b)b.click(); })()`);
  await sleep(1200);
  const back1 = await ev(`location.hash`);
  check('从错题解析返回 → 回到错题本', back1.includes('wrong'), back1);

  /* ---------- 验收 5：答题卡点题号 ---------- */
  console.log('\n[4] 答题卡点题号 → 进入题目详情，不跳主页');
  await ev(`location.hash = '#/quiz/chapter/p1-1';`); await sleep(1500);
  await ev(`location.hash = '#/sheet';`); await sleep(1400);
  await ev(`document.querySelector('.sheet-cell').click()`);
  await sleep(1300);
  const s1 = await ev(`({
    hash: location.hash,
    isHome: (document.querySelector('.header__title')||{}).innerText === '答题闯关',
    hasStem: Boolean(document.querySelector('.stem__text')),
  })`);
  check('未交卷时点题号 → 回到答题页（不是主页）', !s1.isHome && s1.hasStem, `${s1.hash} 有题干=${s1.hasStem}`);
  // 返回应回到答题卡
  await ev(`(() => { const b=document.querySelector('.header__back'); if(b)b.click(); })()`);
  await sleep(1200);
  const back2 = await ev(`({ hash: location.hash, isSheet: Boolean(document.querySelector('.sheet-grid')) })`);
  check('从答题页返回 → 回到答题卡', back2.hash.includes('sheet') || back2.isSheet, back2.hash);

  /* ---------- 已交卷状态下点答题卡题号 ---------- */
  console.log('\n[5] 已交卷后点答题卡题号 → 定位到该题解析（原先跳主页）');
  await ev(`location.hash = '#/quiz/exam?n=3&t=5&s=politics';`); await sleep(1600);
  // 交卷按钮只在最后一题出现，先翻到最后一题
  for (let i = 0; i < 5; i += 1) {
    const hasSubmit = await ev(`[...document.querySelectorAll('.footer-bar .btn')].some(b=>b.innerText.includes('交卷'))`);
    if (hasSubmit) break;
    await ev(`(() => { const b=[...document.querySelectorAll('.footer-bar .btn')].find(x=>x.innerText.includes('下一题')); if(b)b.click(); })()`);
    await sleep(700);
  }
  await ev(`(() => { const b=[...document.querySelectorAll('.footer-bar .btn')].find(x=>x.innerText.includes('交卷')); if(b)b.click(); })()`);
  await sleep(700);
  // 确认弹窗
  await ev(`(() => {
    const d = document.querySelector('.dialog');
    if (!d) return;
    const ok = [...d.querySelectorAll('.btn')].find((x) => /确定|交卷/.test(x.innerText));
    if (ok) ok.click();
  })()`);
  await sleep(2000);
  const submitted = await ev(`location.hash`);
  check('已进入结果页', submitted.includes('result'), submitted);
  await ev(`location.hash = '#/sheet';`); await sleep(1400);
  await ev(`document.querySelector('.sheet-cell').click()`);
  await sleep(1600);
  const s2 = await ev(`({
    hash: location.hash,
    isHome: (document.querySelector('.header__title')||{}).innerText === '答题闯关',
    // 结果页会罗列整套题，这里只数被定位到的那一题里的选项
    anchored: Boolean(document.querySelector('.analysis-item[data-anchor="1"]')),
    anchoredOptions: document.querySelectorAll('.analysis-item[data-anchor="1"] .options--analysis .option').length,
    anchoredLabels: [...document.querySelectorAll('.analysis-item[data-anchor="1"] .option__labels .tag')].map(t=>t.innerText.trim()),
  })`);
  check('已交卷点题号 → 结果页且未跳主页', !s2.isHome && s2.hash.includes('result'), s2.hash);
  check('结果页定位到目标题并显示 4 个选项',
    s2.anchored && s2.anchoredOptions === 4,
    `定位=${s2.anchored} 选项数=${s2.anchoredOptions}`);
  check('定位题带颜色标签', s2.anchoredLabels.length > 0, s2.anchoredLabels.join('/'));
  await shot('92-sheet-to-result-question');

  /* ---------- 验收 7：英语选择题同样正常 ---------- */
  console.log('\n[6] 英语选择题同样正常');
  await ev(`location.hash = '#/chapter/en-grammar';`); await sleep(1300);
  await ev(`(() => { const b=[...document.querySelectorAll('.btn')].find(x=>x.innerText.includes('开始顺序练习')); if(b)b.click(); })()`);
  await sleep(1400);
  await ev(`document.querySelector('.option').click()`);
  await sleep(1100);
  const en = await ev(READ_OPTIONS);
  check('英语解析页也显示 4 个选项', en.count === 4, `实际 ${en.count}`);
  const enRight = (en.items || []).find((x) => x.labels.includes('正确答案'));
  check('英语正确答案为绿色', enRight && classify(enRight.color) === 'green', enRight ? enRight.color : '');
  await shot('93-english-analysis');

  /* ---------- 验收 8：主观题不受影响 ---------- */
  console.log('\n[7] 主观题 / 辨析题不受影响');
  await ev(`location.hash = '#/chapter/subj-jd';`); await sleep(1300);
  await ev(`(() => { const b=[...document.querySelectorAll('.btn')].find(x=>x.innerText.includes('开始顺序练习')); if(b)b.click(); })()`);
  await sleep(1500);
  const subjBefore = await ev(`({
    hasTextarea: Boolean(document.querySelector('.short-input, textarea')),
    hasOptions: document.querySelectorAll('.options .option').length,
    hasRevealBtn: [...document.querySelectorAll('.footer-bar .btn')].some(b=>b.innerText.includes('看解析')),
  })`);
  check('主观题仍是文本框、无 ABCD 选项', subjBefore.hasTextarea && subjBefore.hasOptions === 0, JSON.stringify(subjBefore));
  await ev(`(() => { const b=[...document.querySelectorAll('.footer-bar .btn')].find(x=>x.innerText.includes('看解析')); if(b)b.click(); })()`);
  await sleep(1100);
  const subjAfter = await ev(`({
    analysisOptions: document.querySelectorAll('.options--analysis .option').length,
    feedbackText: (document.querySelector('.feedback')||{}).innerText ? document.querySelector('.feedback').innerText.replace(/\\n/g,' | ').slice(0,90) : '',
    hasPoints: document.querySelectorAll('.points__item').length,
  })`);
  check('主观题不渲染选择题选项', subjAfter.analysisOptions === 0, `实际 ${subjAfter.analysisOptions}`);
  check('主观题显示参考答案与评分提示', subjAfter.hasPoints > 0 || subjAfter.feedbackText.includes('参考'), subjAfter.feedbackText);
  await shot('94-subjective-unaffected');

  /* ---------- 验收 9：控制台无报错 ---------- */
  console.log('\n[8] 控制台');
  const real = consoleErrors.filter((e) => !/favicon|manifest/i.test(e));
  check('无 JS 报错', real.length === 0, real.slice(0, 2).join(' | '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n结果: ${results.length - failed.length} 通过, ${failed.length} 失败`);
  if (failed.length) failed.forEach((f) => console.log(`  - ${f.name}`));
  console.log('');
  ws.close(); child.kill();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('验收异常:', e); try { child.kill(); } catch {} process.exit(1); });
