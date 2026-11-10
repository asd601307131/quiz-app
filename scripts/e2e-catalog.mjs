/**
 * 板块导航与答题技巧板块的端到端验证。
 *
 *   node scripts/e2e-catalog.mjs http://localhost:5213
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

const PORT = 9351;
const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(OUT, '.profile-catalog')}`,
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

async function goto(hash, wait = 1000) {
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
    source: `try { localStorage.clear(); localStorage.setItem('quizapp.v1.settings', JSON.stringify({ autoNext: false })); } catch (e) {}`,
  });

  console.log('\n[1] 首页：两大板块入口');
  await send('Page.navigate', { url: `${BASE}/#/home` });
  await sleep(1800);
  const home = await evaluate(`({
    text: document.body.innerText,
    subjectBars: document.querySelectorAll('.subject-bar').length,
    tabbar: [...document.querySelectorAll('.tabbar__item')].map((a) => a.innerText.replace(/\\n/g, '')),
  })`);
  // 从应用数据里读板块数量与首个板块，避免写死题型/科目名
  const bankMeta = await evaluate(`(async () => {
    const s = await import('./src/data/subjects.js');
    const q = await import('./src/data/questions.js');
    return {
      subjects: s.SUBJECTS.map((x) => ({ id: x.id, name: x.name, groups: x.groups.length })),
      questions: q.QUESTIONS.length,
      chapters: q.CHAPTERS.length,
    };
  })()`);
  const SUBJ = bankMeta.subjects[0];
  console.log(`     板块 ${bankMeta.subjects.map((s) => s.name).join(' / ')}；题库 ${bankMeta.questions} 题 / ${bankMeta.chapters} 章节`);

  check('首页渲染成功', home.text.includes('题库板块'));
  check('首页展示板块入口', home.subjectBars === bankMeta.subjects.length,
    `入口数=${home.subjectBars} 期望=${bankMeta.subjects.length}`);
  check('首页显示板块名称', home.text.includes(SUBJ.name), home.text.slice(0, 60));
  check('底部标签含题库与技巧', home.tabbar.some((t) => t.includes('题库')) && home.tabbar.some((t) => t.includes('技巧')), home.tabbar.join(' / '));
  await shot('50-home-subjects');

  console.log('\n[2] 题库板块页');
  await goto('#/subjects');
  const subjects = await evaluate(`({
    cards: document.querySelectorAll('.subject-card').length,
    text: document.body.innerText,
  })`);
  check('板块页展示全部板块', subjects.cards === bankMeta.subjects.length,
    `卡片数=${subjects.cards} 期望=${bankMeta.subjects.length}`);
  check('板块页显示各板块名称', bankMeta.subjects.every((s) => subjects.text.includes(s.name)),
    bankMeta.subjects.map((s) => s.name).join('/'));
  check('板块页含答题技巧入口', subjects.text.includes('答题技巧'));
  await shot('51-subjects');

  console.log(`\n[3] ${SUBJ.name}：分组与章节`);
  await goto(`#/subject/${SUBJ.id}`);
  const politics = await evaluate(`({
    text: document.body.innerText,
    groups: document.querySelectorAll('.group__head').length,
    items: document.querySelectorAll('.list__item').length,
    titles: [...document.querySelectorAll('.group__title')].map((g) => g.innerText.trim()),
  })`);
  check('科目页可打开', politics.text.includes(SUBJ.name), politics.text.slice(0, 40));
  check('科目页按分组展示', politics.groups >= 1, `分组数=${politics.groups}`);
  check('分组标题非空', politics.titles.length > 0 && politics.titles.every((t) => t.length > 0),
    politics.titles.join(' | ').slice(0, 60));
  // 展开全部分组后检查章节条目
  await evaluate(`(() => { document.querySelectorAll('.group__head').forEach(h => { if (h.getAttribute('aria-expanded') === 'false') h.click(); }); })()`);
  await sleep(800);
  const expandedItems = await evaluate(`document.querySelectorAll('.list__item').length`);
  check('展开后列出章节', expandedItems >= bankMeta.chapters, `条目=${expandedItems} 章节=${bankMeta.chapters}`);
  await shot('52-subject-detail');

  // 分组折叠：清除折叠偏好后重新进入，恢复「默认只展开第一组」
  await evaluate(`(() => {
    try {
      const raw = localStorage.getItem('quizapp.v1.ui');
      const obj = raw ? JSON.parse(raw) : {};
      Object.keys(obj).forEach((k) => { if (String(k).indexOf('collapsed') >= 0) delete obj[k]; });
      localStorage.setItem('quizapp.v1.ui', JSON.stringify(obj));
    } catch (e) {}
  })()`);
  await goto(`#/subjects`);
  await sleep(500);
  await goto(`#/subject/${SUBJ.id}`);
  await sleep(1000);
  const collapse = await evaluate(`(() => {
    const heads = [...document.querySelectorAll('.group__head')];
    return {
      heads: heads.length,
      expanded: heads.filter((x) => x.getAttribute('aria-expanded') === 'true').length,
      visibleLists: [...document.querySelectorAll('.page__body .list')].filter((l) => !l.classList.contains('is-hidden')).length,
    };
  })()`);
  check('分组可折叠且默认只展开一组', collapse.heads >= 1 && collapse.expanded === 1, `分组=${collapse.heads} 展开=${collapse.expanded}`);

  // 点击第二个分组标题应展开
  await evaluate(`(() => {
    const heads = [...document.querySelectorAll('.group__head')];
    if (heads[1]) heads[1].click();
  })()`);
  await sleep(700);
  const afterExpand = await evaluate(`(() => {
    const heads = [...document.querySelectorAll('.group__head')];
    return {
      expanded: heads.filter((x) => x.getAttribute('aria-expanded') === 'true').length,
      hidden: [...document.querySelectorAll('.page__body .list')].filter((l) => l.classList.contains('is-hidden')).length,
    };
  })()`);
  check('点击分组标题可展开', afterExpand.expanded === 2, `展开=${afterExpand.expanded} 分组=${politics.groups}`);

  // 再点一次应折叠回去
  await evaluate(`(() => {
    const heads = [...document.querySelectorAll('.group__head')];
    if (heads[1]) heads[1].click();
  })()`);
  await sleep(700);
  const afterCollapse = await evaluate(`([...document.querySelectorAll('.group__head')].filter((x) => x.getAttribute('aria-expanded') === 'true').length)`);
  check('再次点击可折叠', afterCollapse === 1, `展开=${afterCollapse} 期望=1`);
  await shot('52b-subject-collapsed');

  console.log('\n[4] 从板块进入章节答题');
  await goto(`#/subject/${SUBJ.id}`);
  await sleep(700);
  await evaluate(`(() => { document.querySelectorAll('.group__head').forEach(h => { if (h.getAttribute('aria-expanded') === 'false') h.click(); }); })()`);
  await sleep(700);
  await evaluate(`(() => {
    const item = document.querySelector('.list__item');
    if (item) item.click();
  })()`);
  await sleep(1200);
  const chapter = await evaluate(`({
    hash: location.hash,
    hasStartBtn: [...document.querySelectorAll('.btn')].some((b) => b.innerText.includes('开始顺序练习')),
    text: document.body.innerText.slice(0, 120),
  })`);
  check('可进入具体章节', chapter.hash.includes('chapter/'), chapter.hash);
  check('章节详情有开始练习按钮', chapter.hasStartBtn, chapter.text.replace(/\n/g, ' ').slice(0, 60));
  await evaluate(`(() => {
    const btn = document.querySelector('.footer-bar .btn.btn--primary') || document.querySelector('.btn.btn--primary');
    if (btn) btn.click();
  })()`);
  await sleep(1400);
  const quiz = await evaluate(`({
    hash: location.hash,
    stem: document.querySelector('.stem__text') ? document.querySelector('.stem__text').innerText.slice(0, 30) : null,
    options: document.querySelectorAll('.option').length,
  })`);
  check('可从板块一路进入答题', Boolean(quiz.stem) && quiz.options >= 2, JSON.stringify(quiz).slice(0, 90));
  await shot('54-answer-from-subject');

  console.log('\n[6] 答题技巧板块（内容讲解）');
  await goto('#/strategy');
  const strategyMeta = await evaluate(`(async () => {
    const s = await import('./src/data/strategy.js');
    return {
      categories: s.STRATEGY_SUBJECTS.map((x) => x.name),
      topics: s.STRATEGY_TOPICS.map((t) => t.id),
    };
  })()`);
  const strategy = await evaluate(`({
    text: document.body.innerText,
    items: document.querySelectorAll('.list__item').length,
  })`);
  strategy.categories = strategyMeta.categories;
  check('技巧板块首页可打开', strategy.text.includes('答题技巧'));
  check('技巧板块显示全部分类', strategy.categories.every((k) => strategy.text.includes(k)), strategy.categories.join('/') + ' | ' + strategy.text.slice(0, 40));
  check('技巧条目数量充足', strategy.items >= 10, `条目数=${strategy.items}`);
  await shot('55-strategy-index');

  // 进入一篇含表格与提示的讲解
  await goto(`#/strategy/${strategyMeta.topics[0]}`);
  const topic = await evaluate(`({
    title: document.querySelector('.strategy-title') ? document.querySelector('.strategy-title').innerText : null,
    tables: document.querySelectorAll('.strategy-table').length,
    tips: document.querySelectorAll('.strategy-tip').length,
    paragraphs: document.querySelectorAll('.strategy-p, .strategy-list__item, .strategy-tip, .strategy-table tbody tr').length,
    text: document.body.innerText,
  })`);
  check('讲解页显示标题', Boolean(topic.title), topic.title || '');
  check('讲解页含对照表格', topic.tables >= 1, `表格数=${topic.tables}`);
  check('含强调提示框', topic.tips >= 1, `提示数=${topic.tips}`);
  check('内容有实质文字', topic.paragraphs >= 5 && topic.text.length > 300, `内容块=${topic.paragraphs} 字数=${topic.text.length}`);
  await shot('56-strategy-topic');

  // 分页导航：下一篇
  const nav = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('.footer-bar .btn')];
    return btns.map((b) => b.innerText.trim());
  })()`);
  check('讲解页有上一篇/下一篇导航', nav.length === 2 && nav.some((t) => t.includes('下一篇')), nav.join(' | '));
  await evaluate(`(() => {
    const next = [...document.querySelectorAll('.footer-bar .btn')].find((b) => b.innerText.includes('下一篇'));
    if (next) next.click();
  })()`);
  await sleep(1100);
  const nextTitle = await evaluate(`document.querySelector('.strategy-title') ? document.querySelector('.strategy-title').innerText : null`);
  check('可翻到下一篇', Boolean(nextTitle), nextTitle || '');

  // 检查另一篇（作文句型，含表格）
  await goto(`#/strategy/${strategyMeta.topics[1] || strategyMeta.topics[0]}`);
  const writing = await evaluate(`({
    title: document.querySelector('.strategy-title') ? document.querySelector('.strategy-title').innerText : null,
    tables: document.querySelectorAll('.strategy-table').length,
    rows: document.querySelectorAll('.strategy-table tbody tr').length,
    text: document.body.innerText,
  })`);
  check('另一篇讲解内容正常', writing.text && writing.text.length > 100, `字数=${(writing.text || '').length} 表格=${writing.tables}`);
  check('另一篇含标题', Boolean(writing.title), writing.title || '');
  await shot('57-strategy-writing');

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
