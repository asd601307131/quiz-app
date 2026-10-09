/**
 * 按主题截图（浅色 / 深色），用于人工核对视觉效果。
 *
 *   node scripts/shot.mjs http://localhost:5213            # 浅色
 *   node scripts/shot.mjs http://localhost:5213 dark       # 深色
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = process.argv[2] || 'http://localhost:5213';
const THEME = process.argv[3] === 'dark' ? 'dark' : 'light';
const OUT = path.join(ROOT, 'screenshots');

const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

const PORT = THEME === 'dark' ? 9361 : 9360;
const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(OUT, `.profile-shot-${THEME}`)}`,
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

const SHOTS = [
  { file: 'home', hash: '#/home', height: 1500 },
  { file: 'subject', hash: '#/subject/politics', height: 1400 },
  { file: 'strategy', hash: '#/strategy/strat-pol-essay', height: 1500 },
  { file: 'quiz', hash: '#/chapter/subj-bx', height: 1100 },
];

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
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: THEME }],
  });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try {
      localStorage.clear();
      localStorage.setItem('quizapp.v1.settings', JSON.stringify({ autoNext: false }));
      localStorage.setItem('quizapp.v1.stats', JSON.stringify({ answered: 168, correct: 141, streakDays: 5 }));
    } catch (e) {}`,
  });

  await send('Page.navigate', { url: `${BASE}/#/home` });
  await sleep(2000);

  console.log(`\n主题: ${THEME}\n`);
  for (const shot of SHOTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: shot.height, deviceScaleFactor: 2, mobile: true,
    });
    await evaluate(`location.hash = ${JSON.stringify(shot.hash)};`);
    await sleep(1300);
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const name = `${THEME === 'dark' ? '74' : '73'}-ui-${THEME}-${shot.file}.png`;
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    console.log(`  📸 screenshots\\${name}`);
  }
  console.log('');

  ws.close();
  child.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error('截图异常:', err);
  try { child.kill(); } catch (e) { /* ignore */ }
  process.exit(1);
});
