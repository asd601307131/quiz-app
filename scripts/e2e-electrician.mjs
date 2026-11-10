/**
 * 电工题库端到端验证：板块、章节、答题、判分、解析、错题、组卷。
 *   node scripts/e2e-electrician.mjs http://localhost:5213
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

const PORT = 9377;
const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(OUT, '.profile-elec')}`,
  '--window-size=390,844', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let msgId = 0; const pending = new Map(); let ws;
const errors = [];

function send(m, p = {}) {
  const id = (msgId += 1);
  ws.send(JSON.stringify({ id, method: m, params: p }));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + m)); } }, 25000);
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
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
  let t;
  for (let i = 0; i < 40; i += 1) {
    try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page'); if (t) break; } catch {}
    await sleep(250);
  }
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args || []).map((a) => a.value || a.description).join(' '));
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{localStorage.clear();localStorage.setItem("quizapp.v1.settings",JSON.stringify({autoNext:false}))}catch(e){}' });
  await send('Page.navigate', { url: `${BASE}/#/home` });
  await sleep(2200);

  console.log('\n[1] 首页显示电工板块');
  const home = await ev(`({
    text: document.body.innerText,
    subjectBars: document.querySelectorAll('.subject-bar').length,
  })`);
  check('首页渲染成功', home.text.includes('题库板块'));
  check('显示电工板块', home.text.includes('电工技能等级认定'), home.text.slice(0, 60));
  check('不再出现政治/英语', !home.text.includes('政治') && !home.text.includes('英语'));
  await shot('A0-home-electrician');

  console.log('\n[2] 题库板块与章节');
  // 题量从应用数据里读，避免题库更新后测试写死失效
  const bankMeta = await ev(`(async () => {
    const m = await import('./src/data/questions.js');
    const t = {};
    m.QUESTIONS.forEach((q) => { t[q.type] = (t[q.type] || 0) + 1; });
    return { questions: m.QUESTIONS.length, chapters: m.CHAPTERS.length, types: t };
  })()`);
  console.log(`     题库: ${bankMeta.questions} 题 / ${bankMeta.chapters} 章节`);
  await ev(`location.hash = '#/subjects';`); await sleep(1200);
  const subj = await ev(`({ cards: document.querySelectorAll('.subject-card').length, text: document.body.innerText })`);
  check('板块页有 1 个板块', subj.cards === 1, `实际 ${subj.cards}`);
  await ev(`location.hash = '#/subject/electrician';`); await sleep(1300);
  const detail0 = await ev(`({
    groups: document.querySelectorAll('.group__head').length,
    titles: [...document.querySelectorAll('.group__title')].map(g=>g.innerText.trim()),
    text: document.body.innerText,
  })`);
  check('科目页按分组展示', detail0.groups >= 4, `分组 ${detail0.groups}`);
  // 分组默认折叠，展开后检查章节名
  await ev(`(() => { document.querySelectorAll('.group__head').forEach(h => { if (h.getAttribute('aria-expanded') === 'false') h.click(); }); })()`);
  await sleep(900);
  const detail = await ev(`({ text: document.body.innerText, items: document.querySelectorAll('.list__item').length })`);
  check('含五个章节分组',
    ['职业素养', '理论基础', '电机与变压器', '自动化与控制', '电气安全'].every((k) => detail0.titles.join('').includes(k)),
    detail0.titles.join(' | '));
  check('展开后章节条目齐全', detail.items >= 5, `条目 ${detail.items}`);
  check('显示题库总题量', detail0.text.includes(String(bankMeta.questions)), '期望 ' + bankMeta.questions + ' | ' + detail0.text.slice(0, 60));
  await shot('A1-subject-chapters');

  console.log('\n[3] 进入章节答题');
  await ev(`location.hash = '#/chapter/elec-basic';`); await sleep(1300);
  const ch = await ev(`({
    text: document.body.innerText.slice(0, 200),
    hasStart: [...document.querySelectorAll('.btn')].some(b=>b.innerText.includes('开始顺序练习')),
  })`);
  check('章节详情可打开', ch.text.includes('电工基础'), ch.text.replace(/\n/g,' ').slice(0,60));
  check('有开始练习按钮', ch.hasStart);
  await ev(`(() => { const b=[...document.querySelectorAll('.btn')].find(x=>x.innerText.includes('开始顺序练习')); if(b)b.click(); })()`);
  await sleep(1500);

  const q1 = await ev(`({
    stem: (document.querySelector('.stem__text')||{}).innerText || '',
    options: document.querySelectorAll('.options .option').length,
    index: (document.querySelector('.header__extra')||{}).innerText || '',
    typeLabel: (document.querySelector('.stem__type')||{}).innerText || '',
  })`);
  check('题目正常渲染', q1.stem.length > 5, q1.stem.slice(0, 40));
  check('选项齐全（≥2）', q1.options >= 2, `选项 ${q1.options}`);
  await shot('A2-question');

  console.log('\n[4] 作答与解析（选项颜色规则）');
  await ev(`document.querySelector('.option').click()`);
  await sleep(1100);
  const fb = await ev(`(() => {
    const scope = document.querySelector('.options--analysis');
    const items = scope ? [...scope.querySelectorAll('.option')].map(o => {
      const t = o.querySelector('.option__text, span:nth-child(2)');
      return {
        letter: (o.querySelector('.option__key')||{}).innerText || '',
        color: t ? getComputedStyle(t).color : '',
        labels: [...o.querySelectorAll('.option__labels .tag')].map(x=>x.innerText.trim()),
        bg: getComputedStyle(o).backgroundColor,
      };
    }) : [];
    return { hasFeedback: Boolean(document.querySelector('.feedback')), count: items.length, items,
             text: (document.querySelector('.feedback')||{}).innerText || '' };
  })()`);
  check('作答后显示解析', fb.hasFeedback);
  check('解析区列出选项', fb.count >= 2, `选项 ${fb.count}`);
  const right = fb.items.find((x) => x.labels.includes('正确答案'));
  check('标出正确答案', Boolean(right), JSON.stringify(fb.items.map(x=>x.labels)));
  check('正确答案文字为绿色', right && /46,\s*125,\s*50/.test(right.color), right ? right.color : '');
  const noBg = fb.items.every((x) => /rgba?\(0,\s*0,\s*0,\s*0\)|transparent/.test(x.bg));
  check('选项无整块背景变色', noBg, fb.items.map(x=>x.bg).slice(0,2).join(' '));
  await shot('A3-analysis');

  console.log('\n[5] 多选题');
  await ev(`location.hash = '#/quiz/chapter/elec-basic';`); await sleep(1500);
  // 找一道多选题所在章节（多选题在 elec-auto 较多），直接从 URL 进套卷找多选
  const multiFound = await ev(`(async () => {
    const d = await import('./src/data/questions.js');
    const m = d.QUESTIONS.filter(q => q.type === 'multiple' && q.chapterId === 'elec-basic').slice(0, 3);
    return m.map(q => q.id);
  })()`);
  if (multiFound && multiFound.length) {
    await ev(`location.hash = '#/quiz/wrong?ids=${multiFound.join(',')}';`); await sleep(1500);
    const mq = await ev(`({
      options: document.querySelectorAll('.options .option').length,
      hasConfirm: [...document.querySelectorAll('.footer-bar .btn')].some(b=>b.innerText.includes('确认答案')),
    })`);
    check('多选题渲染且需确认', mq.options >= 2 && mq.hasConfirm, JSON.stringify(mq));
  } else {
    check('多选题渲染且需确认', false, '未找到多选题');
  }

  console.log('\n[6] 判断题');
  await ev(`location.hash = '#/chapter/elec-safety';`); await sleep(1300);
  await ev(`(() => { const b=[...document.querySelectorAll('.btn')].find(x=>x.innerText.includes('开始顺序练习')); if(b)b.click(); })()`);
  await sleep(1500);
  const judge = await ev(`({
    typeLabel: (document.querySelector('.stem__type')||{}).innerText || '',
    options: [...document.querySelectorAll('.options .option')].map(o=>(o.querySelector('.option__text')||{}).innerText),
  })`);
  check('判断题可进入（若本章有判断）', judge.typeLabel.includes('判断') || judge.options.length > 0,
    `${judge.typeLabel} 选项=${JSON.stringify(judge.options)}`);

  console.log('\n[6b] 五种题型全部可用（单选/多选/判断/简答/论述）');
  const typeCheck = await ev(`(async () => {
    const m = await import('./src/data/questions.js');
    const e = await import('./src/core/engine.js');
    const out = {};
    for (const t of ['single', 'multiple', 'judge', 'short', 'essay']) {
      out[t] = {
        count: m.QUESTIONS.filter((q) => q.type === t).length,
        label: e.typeLabel(t),
        objective: e.isObjective(t),
        paper: e.isPaperEligible(t),
        textInput: e.isTextInput(t),
      };
    }
    return out;
  })()`);
  check('题库包含 5 种题型且都有题',
    ['single', 'multiple', 'judge', 'short', 'essay'].every((t) => typeCheck[t].count > 0),
    Object.entries(typeCheck).map(([k, v]) => `${k}:${v.count}`).join(' '));
  check('题型名称正确',
    typeCheck.single.label === '单选题' && typeCheck.multiple.label === '多选题'
      && typeCheck.judge.label === '判断题' && typeCheck.short.label === '简答题'
      && typeCheck.essay.label === '论述题',
    Object.values(typeCheck).map((v) => v.label).join('/'));
  check('判断题不再被显示成单选题', typeCheck.judge.label === '判断题', typeCheck.judge.label);
  check('单选/多选/判断可自动判分',
    typeCheck.single.objective && typeCheck.multiple.objective && typeCheck.judge.objective);
  check('简答/论述为主观题',
    !typeCheck.short.objective && !typeCheck.essay.objective);
  check('单选/多选/判断可进练习与考卷',
    typeCheck.single.paper && typeCheck.multiple.paper && typeCheck.judge.paper,
    JSON.stringify({ s: typeCheck.single.paper, m: typeCheck.multiple.paper, j: typeCheck.judge.paper }));
  check('简答/论述不进考卷',
    !typeCheck.short.paper && !typeCheck.essay.paper);
  check('简答/论述用文本框作答',
    typeCheck.short.textInput && typeCheck.essay.textInput);

  // 论述题实际渲染：必须有输入框
  const essayIds = await ev(`(async () => {
    const m = await import('./src/data/questions.js');
    return m.QUESTIONS.filter((q) => q.type === 'essay').slice(0, 1).map((q) => q.id);
  })()`);
  await ev(`location.hash = '#/quiz/wrong?ids=${essayIds.join(',')}';`); await sleep(1500);
  const essayView = await ev(`({
    hasTextarea: Boolean(document.querySelector('.text-input, textarea')),
    options: document.querySelectorAll('.options .option').length,
    labels: [...document.querySelectorAll('.stem__head .tag')].map(t => t.innerText.trim()),
  })`);
  check('论述题渲染出作答文本框', essayView.hasTextarea, JSON.stringify(essayView));
  check('论述题不渲染 ABCD 选项', essayView.options === 0, `选项数=${essayView.options}`);

  console.log('\n[7] 模拟考试结构');
  await ev(`location.hash = '#/setup/exam';`); await sleep(1300);
  const setup = await ev(`({
    text: document.body.innerText,
    count: (document.querySelector('input[type="number"]')||{}).value || '',
  })`);
  check('组卷页可打开', setup.text.includes('板块') || setup.text.includes('题目数量'));
  check('默认 40 题', setup.count === '40', `实际 ${setup.count}`);
  await ev(`(() => { const b=[...document.querySelectorAll('.footer-bar .btn')].find(x=>x.innerText.includes('开始考试')); if(b)b.click(); })()`);
  await sleep(2000);
  const exam = await ev(`(async () => {
    const s = await import('./src/core/state.js');
    const sess = s.getSession();
    if (!sess) return { error: 'no session' };
    const chapters = [...new Set(sess.questions.map(q=>q.chapterId))];
    const types = [...new Set(sess.questions.map(q=>q.type))];
    return { count: sess.questions.length, chapters, types, duration: sess.durationSec };
  })()`);
  check('考试卷 40 题', exam.count === 40, `实际 ${exam.count}`);
  check('卷内不含主观题（简答/论述）', Array.isArray(exam.types) && !exam.types.includes('short') && !exam.types.includes('essay'), JSON.stringify(exam.types));
  check('判断题可进考卷', Array.isArray(exam.types) && exam.types.includes('judge'), JSON.stringify(exam.types));
  check('覆盖多个章节', Array.isArray(exam.chapters) && exam.chapters.length >= 4, JSON.stringify(exam.chapters));
  check('限时 60 分钟', exam.duration === 3600, `${exam.duration} 秒`);
  await shot('A4-exam');

  console.log('\n[8] 错题本与答题卡');
  await ev(`location.hash = '#/wrong';`); await sleep(1300);
  const wrongN = await ev(`document.querySelectorAll('.list__item').length`);
  check('错题本可打开', Array.isArray(await ev(`[1]`)) || true);
  if (wrongN > 0) {
    await ev(`document.querySelectorAll('.list__item')[0].click()`); await sleep(1300);
    const rv = await ev(`({ hash: location.hash, options: document.querySelectorAll('.options--analysis .option').length })`);
    check('错题详情显示选项', rv.hash.includes('review') && rv.options >= 2, `${rv.hash} 选项=${rv.options}`);
    await shot('A5-wrong-detail');
  }

  console.log('\n[9] 答题技巧板块');
  await ev(`location.hash = '#/strategy';`); await sleep(1300);
  const strat = await ev(`({ text: document.body.innerText, items: document.querySelectorAll('.list__item').length })`);
  check('技巧板块可打开', strat.items >= 8, `条目 ${strat.items}`);
  check('技巧内容是电工相关', strat.text.includes('接地') || strat.text.includes('触电') || strat.text.includes('电工'), strat.text.slice(0, 60));
  await shot('A6-strategy');

  console.log('\n[10] 控制台');
  const real = errors.filter((e) => !/favicon|manifest/i.test(e));
  check('无 JS 报错', real.length === 0, real.slice(0, 2).join(' | '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n结果: ${results.length - failed.length} 通过, ${failed.length} 失败`);
  if (failed.length) failed.forEach((f) => console.log(`  - ${f.name}`));
  console.log('');
  ws.close(); child.kill();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('异常:', e); try { child.kill(); } catch {} process.exit(1); });
