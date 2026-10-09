/**
 * UI 体检：用无头浏览器在 390×844 手机视口下逐页测量，找出真实的排版问题。
 *
 *   node scripts/ui-audit.mjs http://localhost:5213
 *
 * 检查项：
 *   1. 文本被截断（scrollWidth > clientWidth 的文本节点）
 *   2. 溢出视口的元素（right > 视口宽度）
 *   3. 触控目标过小（可点区域高或宽 < 40px）
 *   4. 首屏信息密度（首屏可见内容块数量）
 *   5. 页面总高度（过长说明需要折叠）
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

const PORT = 9355;
const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(OUT, '.profile-ui')}`,
  '--window-size=390,844', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let msgId = 0; const pending = new Map(); let ws;

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

const PAGES = [
  { name: '首页', hash: '#/home' },
  { name: '板块', hash: '#/subjects' },
  { name: '政治板块', hash: '#/subject/politics' },
  { name: '英语板块', hash: '#/subject/english' },
  { name: '技巧目录', hash: '#/strategy' },
  { name: '技巧详情', hash: '#/strategy/strat-exam-score' },
  { name: '章节详情', hash: '#/chapter/subj-bx' },
  { name: '错题本', hash: '#/wrong' },
  { name: '记录', hash: '#/history' },
  { name: '我的', hash: '#/profile' },
];

/** 深色模式下的对比度检查：正文区域不应出现"深底深字" */
const DARK_PROBE = `(() => {
  const parse = (c) => {
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  };
  // 沿祖先链找到实际生效的不透明背景色
  const bgOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.5) return c;
      node = node.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  };

  const low = [];
  document.querySelectorAll('.list__title, .list__sub, .mode-card__title, .mode-card__desc, .strategy-p, .strategy-list__item, .strategy-table td, .strategy-tip, .stem__text, .option, .group__title, .card p, .hero__stat span').forEach((el) => {
    const text = (el.innerText || '').trim();
    if (!text) return;
    const fg = parse(getComputedStyle(el).color);
    if (!fg || fg.a < 0.5) return;
    const bg = bgOf(el);
    const r = ratio(fg, bg);
    if (r < 4.5) low.push({ cls: el.className, ratio: Number(r.toFixed(2)), text: text.slice(0, 26) });
  });
  return { lowContrast: low.slice(0, 8), lowCount: low.length };
})()`;

const PROBE = `(() => {
  const vw = document.documentElement.clientWidth;

  // 1) 文本被截断：元素自身有省略号或被裁剪
  const clipped = [];
  document.querySelectorAll('.list__title, .list__sub, .mode-card__title, .mode-card__desc, .strategy-title, .strategy-summary, .subject-card__progress, .mastery-hint, .card p, .section__title, .tag').forEach((el) => {
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      clipped.push({ cls: el.className, text: (el.innerText || '').slice(0, 34), over: el.scrollWidth - el.clientWidth });
    }
  });

  // 2) 横向溢出视口
  const overflow = [];
  document.querySelectorAll('.page *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 1) {
      overflow.push({ cls: el.className, right: Math.round(r.right), w: Math.round(r.width) });
    }
  });

  // 3) 触控目标过小
  const small = [];
  document.querySelectorAll('button, a.tabbar__item, .option, .sheet-cell').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.height < 40 || r.width < 40) {
      small.push({ cls: el.className, w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText || '').slice(0, 16) });
    }
  });

  // 4) 首屏可见内容块
  let firstScreenBlocks = 0;
  document.querySelectorAll('.page__body > *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < 844 && r.bottom > 0) firstScreenBlocks += 1;
  });

  return {
    vw,
    pageHeight: document.documentElement.scrollHeight,
    clipped: clipped.slice(0, 8),
    clippedCount: clipped.length,
    overflow: overflow.slice(0, 6),
    overflowCount: overflow.length,
    small: small.slice(0, 8),
    smallCount: small.length,
    firstScreenBlocks,
    cardCount: document.querySelectorAll('.card, .mode-card, .list__item, .subject-bar').length,
  };
})()`;

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
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.clear(); localStorage.setItem('quizapp.v1.settings', JSON.stringify({ autoNext: false })); } catch (e) {}`,
  });

  console.log('\n════════ UI 体检报告（390×844 手机视口）════════\n');

  // 先真正导航到应用，否则测到的只是空壳页面
  await send('Page.navigate', { url: `${BASE}/#/home` });
  await sleep(2200);

  const bootOk = await evaluate(`Boolean(document.querySelector('.page'))`);
  if (!bootOk) {
    console.error('应用未加载，请确认本地服务已启动');
    ws.close();
    child.kill();
    process.exit(1);
  }

  const summary = [];
  for (const page of PAGES) {
    await evaluate(`location.hash = ${JSON.stringify(page.hash)};`);
    await sleep(1200);
    const r = await evaluate(PROBE);
    summary.push({ page: page.name, ...r });

    const issues = [];
    if (r.clippedCount) issues.push(`文本截断 ${r.clippedCount} 处`);
    if (r.overflowCount) issues.push(`横向溢出 ${r.overflowCount} 处`);
    if (r.smallCount) issues.push(`触控过小 ${r.smallCount} 处`);

    console.log(`【${page.name}】 高度 ${r.pageHeight}px · 首屏内容块 ${r.firstScreenBlocks} · 卡片/条目 ${r.cardCount}`);
    console.log(`   ${issues.length ? '⚠ ' + issues.join(' / ') : '✓ 未发现问题'}`);
    r.clipped.slice(0, 4).forEach((c) => console.log(`     截断: 「${c.text}」超出 ${c.over}px (${c.cls})`));
    r.overflow.slice(0, 3).forEach((c) => console.log(`     溢出: ${c.cls} 右边界 ${c.right} > 视口 ${r.vw}`));
    r.small.slice(0, 4).forEach((c) => console.log(`     过小: ${c.w}×${c.h} 「${c.text}」(${c.cls})`));
    console.log('');
  }

  const totalClipped = summary.reduce((a, s) => a + s.clippedCount, 0);
  const totalOverflow = summary.reduce((a, s) => a + s.overflowCount, 0);
  const totalSmall = summary.reduce((a, s) => a + s.smallCount, 0);
  console.log('──────── 汇总 ────────');
  console.log(`  文本截断 ${totalClipped} 处 · 横向溢出 ${totalOverflow} 处 · 触控过小 ${totalSmall} 处`);
  console.log('');

  /* ---- 深色模式：对比度检查 ---- */
  console.log('════════ 深色模式检查（prefers-color-scheme: dark）════════\n');
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });

  let darkLow = 0;
  for (const page of PAGES.slice(0, 6)) {
    await evaluate(`location.hash = ${JSON.stringify(page.hash)};`);
    await sleep(1100);
    const r = await evaluate(DARK_PROBE);
    darkLow += r.lowCount;
    console.log(`【${page.name}】${r.lowCount ? `⚠ 对比度不足 ${r.lowCount} 处` : '✓ 文字对比度达标'}`);
    r.lowContrast.slice(0, 4).forEach((c) => {
      console.log(`     对比度 ${c.ratio}:1 「${c.text}」(${c.cls})`);
    });
  }

  // 深色模式下也检查一次溢出与截断
  await evaluate(`location.hash = '#/subject/politics';`);
  await sleep(1100);
  const darkLayout = await evaluate(PROBE);
  console.log(`\n【政治板块·深色】截断 ${darkLayout.clippedCount} / 溢出 ${darkLayout.overflowCount} / 触控过小 ${darkLayout.smallCount}`);

  await send('Emulation.setEmulatedMedia', { features: [] });

  console.log('\n──────── 深色模式汇总 ────────');
  console.log(`  对比度不足 ${darkLow} 处`);
  console.log('');

  ws.close();
  child.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error('体检异常:', err);
  try { child.kill(); } catch (e) { /* ignore */ }
  process.exit(1);
});
