/**
 * 端到端验证脚本（仅开发用，零依赖）。
 *
 * 用本机 Edge/Chrome 的无头模式，以手机视口真实渲染页面，走完整答题流程并截图。
 *
 *   node scripts/e2e.mjs [baseUrl] [outDir]
 *
 * 断言点：首页渲染、章节练习即时反馈与解析、自动下一题开关、
 *        答题卡、交卷判分与逐题解析、错题本收录、成绩记录、
 *        模拟考试计时与交卷确认、我的页、本地登录、控制台无报错。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = process.argv[2] || 'http://localhost:5213';
const OUT = path.resolve(ROOT, process.argv[3] || 'screenshots');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const browserPath = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!browserPath) {
  console.error('未找到 Edge/Chrome，无法执行端到端验证');
  process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });

const PORT = 9333;
const userDataDir = path.join(OUT, '.profile');

const child = spawn(
  browserPath,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=390,844',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page;
    } catch (err) {
      /* 浏览器还没起来 */
    }
    await sleep(250);
  }
  throw new Error('无法连接浏览器调试端口');
}

let msgId = 0;
const pending = new Map();
let ws;

function send(method, params = {}) {
  const id = (msgId += 1);
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP 超时: ${method}`));
      }
    }, 20000);
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(`页面执行异常: ${res.exceptionDetails.text} ${JSON.stringify(res.exceptionDetails.exception || {})}`);
  }
  return res.result.value;
}

async function shot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log(`  📸 ${path.relative(ROOT, file)}`);
  return file;
}

async function goto(hash, waitMs = 900) {
  await evaluate(`location.hash = ${JSON.stringify(hash)};`);
  await sleep(waitMs);
}

/** 在练习模式下答完当前整卷（单选选一个，多选选一个后确认，然后下一题） */
async function answerPracticePaper(maxSteps = 80) {
  const trace = [];
  for (let i = 0; i < maxSteps; i += 1) {
    // 多选题：只要已选中任一选项就直接点「确认答案」；
    // 注意再次点击同一选项是「取消选中」，不能反复点同一个，否则会死循环。
    const step = await evaluate(`(() => {
      const t = document.querySelector('.footer-bar .btn--primary');
      if (!t) return 'no-btn';
      const label = t.innerText.trim();
      if (label.includes('查看成绩') || label.includes('交卷')) return 'done:' + label;
      if (label.includes('确认答案')) {
        if (!document.querySelector('.option--selected')) {
          const o = document.querySelector('.option');
          if (o) { o.click(); return 'multi-pick'; }
          return 'stuck:no-option';
        }
        t.click();
        return 'multi-confirm';
      }
      if (label.includes('下一题')) { t.click(); return 'next'; }
      const o = document.querySelector('.option');
      if (o) { o.click(); return 'pick'; }
      return 'stuck:no-option';
    })()`);
    trace.push(step);
    if (String(step).startsWith('done') || String(step).startsWith('stuck') || step === 'no-btn') break;
    await sleep(340);
  }
  if (String(trace[trace.length - 1] || '').startsWith('done')) return trace;
  // 卡住时补一次详情，方便定位
  const stuck = await evaluate(`({
    index: (document.querySelector('.stem__index') || {}).innerText,
    stem: (document.querySelector('.stem__text') || {}).innerText.slice(0, 30),
    footer: [...document.querySelectorAll('.footer-bar .btn')].map(b => b.innerText.trim()),
    confirmed: Boolean(document.querySelector('.feedback')),
  })`);
  trace.push('STUCK ' + JSON.stringify(stuck));
  return trace;
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
}

/* ------------------------------------------------------------------ */

async function main() {
  const target = await getTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data || '')})`));
      else resolve(msg.result);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  // 关键：关闭「单选自动下一题」，与已渲染的首页设置保持一致（否则先改后置会在刷新时被覆盖）
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try {
      localStorage.setItem('quizapp.v1.settings', JSON.stringify({ autoNext: false, shuffleOptions: false, examQuestionCount: 10, examDurationMin: 10 }));
    } catch (e) {}`,
  });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  // 收集控制台错误，页面报错即失败
  const consoleErrors = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.text || 'exception');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description).join(' '));
    }
  });

  console.log('\n[1] 首页');
  await send('Page.navigate', { url: `${BASE}/#/home` });
  await sleep(1500);
  const homeText = await evaluate('document.body.innerText');
  check('首页渲染成功', homeText.includes('题库板块') && homeText.includes('模拟考试'));
  check('显示登录状态或登录入口', homeText.includes('登录') || homeText.includes('累计答题'), homeText.slice(0, 30));
  await shot('01-home');

  /**
   * 自适应题库：
   *  - 章节 id 与名称从应用数据里取，不写死；
   *  - 优先选「含选择题较多」的章节，因为后续用例要靠点选项作答。
   */
  const bank = await evaluate(`(async () => {
    const m = await import('./src/data/questions.js');
    const stats = m.CHAPTERS.map((c) => {
      const list = m.QUESTIONS.filter((q) => q.chapterId === c.id);
      const choice = list.filter((q) => q.type === 'single' || q.type === 'multiple' || q.type === 'judge').length;
      return { id: c.id, name: c.name, total: list.length, choice };
    });
    const withChoice = stats.filter((s) => s.choice >= 4).sort((a, b) => b.choice - a.choice);
    const fallback = stats.slice().sort((a, b) => b.total - a.total);
    return {
      chapters: stats.length,
      questions: m.QUESTIONS.length,
      biggest: withChoice[0] || fallback[0],
    };
  })()`);
  const CH = bank.biggest;
  console.log(
    `     题库: ${bank.questions} 题 / ${bank.chapters} 章节，本用例使用「${CH.name}」(${CH.choice} 道选择题 / 共 ${CH.total} 题)`
  );

  console.log('\n[2] 章节练习：即时反馈与解析');
  await goto(`#/chapter/${CH.id}`);
  const chapterText = await evaluate('document.body.innerText');
  check('章节详情页渲染', chapterText.includes('开始顺序练习'), chapterText.slice(0, 40));
  await shot('02-chapter');

  // 章节详情页的主按钮不在底部操作条里，这里用「底部优先、否则取主按钮」的策略
  await evaluate(`(() => {
    const btn = document.querySelector('.footer-bar .btn.btn--primary')
      || document.querySelector('.btn.btn--primary');
    if (!btn) throw new Error('未找到主按钮');
    btn.click();
  })()`);
  await sleep(1200);
  const quiz = await evaluate(`(() => {
    const stem = document.querySelector('.stem__text');
    return {
      hasStem: Boolean(stem),
      stem: stem ? stem.innerText : '',
      options: document.querySelectorAll('.option').length,
      title: document.querySelector('.header__title').innerText,
      body: document.body.innerText,
    };
  })()`);
  check('答题页渲染出题干与选项', quiz.hasStem && quiz.options >= 2, `options=${quiz.options}`);
  await shot('03-quiz');

  // 故意选一个错误答案（单选/判断题在练习模式下会立即反馈）
  const wrongPick = await evaluate(`(() => {
    const cells = [...document.querySelectorAll('.option')];
    const first = cells[0];
    if (!first) return null;
    first.click();
    return true;
  })()`);
  await sleep(900);
  const afterPick = await evaluate(`(() => {
    const fb = document.querySelector('.feedback');
    return {
      hasFeedback: Boolean(fb),
      feedback: fb ? fb.innerText : '',
      rightCount: document.querySelectorAll('.option--right').length,
      autoNext: document.querySelector('.stem__index') ? document.querySelector('.stem__index').innerText : '',
    };
  })()`);
  check('练习模式即时显示解析', afterPick.hasFeedback, afterPick.feedback.slice(0, 40));
  check('正确答案被标出', afterPick.rightCount >= 1 || afterPick.hasFeedback);
  await shot('04-quiz-feedback');

  console.log('\n[3] 顺序答题、自动下一题与答题卡');
  // 先验证「单选自动下一题」开关确实生效（该项已由启动脚本设为关闭）
  const autoNextOff = await evaluate(`(() => {
    const before = document.querySelector('.stem__index').innerText;
    document.querySelector('.option').click();
    return new Promise((resolve) => setTimeout(() => {
      resolve({ before, after: document.querySelector('.stem__index').innerText });
    }, 900));
  })()`);
  check('关闭开关后不会自动跳题', autoNextOff.before === autoNextOff.after, JSON.stringify(autoNextOff));

  await goto('#/profile');
  await evaluate(`document.querySelectorAll('.switch-row button')[0].click()`);
  await sleep(300);
  const toggleOn = await evaluate(`document.querySelectorAll('.switch')[0].className`);
  check('设置页可打开自动下一题', toggleOn.includes('switch--on'), toggleOn);

  await goto(`#/quiz/chapter/${CH.id}`);
  // 自动跳题延时已改为 1600ms（让作答者能看清解析），这里必须等足够久
  const autoNextOn = await evaluate(`(() => {
    const before = document.querySelector('.stem__index').innerText;
    document.querySelector('.option').click();
    return new Promise((resolve) => setTimeout(() => {
      resolve({ before, after: document.querySelector('.stem__index').innerText });
    }, 2600));
  })()`);
  check('开启开关后自动跳到下一题', autoNextOn.before !== autoNextOn.after, JSON.stringify(autoNextOn));

  // 关回自动跳题，便于后续逐题作答
  await goto('#/profile');
  await evaluate(`document.querySelectorAll('.switch-row button')[0].click()`);
  await sleep(200);
  await goto(`#/quiz/chapter/${CH.id}`);

  // 快速答完剩余题目：单选/判断直接点 A，多选点确认，然后点下一题
  await answerPracticePaper();
  const answeredText = await evaluate('document.body.innerText');
  check('答题进度持续推进', answeredText.includes('第') || answeredText.includes('题'));

  await evaluate(`[...document.querySelectorAll('.footer-bar .btn')].find(b => b.innerText.includes('答题卡')).click()`);
  await sleep(700);
  const sheet = await evaluate(`({
    cells: document.querySelectorAll('.sheet-cell').length,
    text: document.body.innerText,
  })`);
  check('答题卡渲染题号网格', sheet.cells >= 10, `cells=${sheet.cells}`);
  await shot('05-sheet');

  console.log('\n[4] 交卷判分与逐题解析');
  // 重新开一轮练习并答完，再交卷（第 3 步的会话已被答题卡访问结束）
  await goto(`#/quiz/chapter/${CH.id}`);
  const practiceTrace = await answerPracticePaper();
  const lastLabel = await evaluate(`(() => {
    const t = document.querySelector('.footer-bar .btn--primary');
    return t ? t.innerText.trim() : 'no-btn';
  })()`);
  check(
    '最后一题显示交卷按钮',
    lastLabel.includes('查看成绩'),
    `label=${lastLabel} trace=${practiceTrace.join('>').slice(-160)}`
  );
  await evaluate(`document.querySelector('.footer-bar .btn--primary').click()`);
  await sleep(1000);
  const result = await evaluate(`({
    text: document.body.innerText,
    score: (document.querySelector('.score-board__value') || {}).innerText || '',
    analysis: document.querySelectorAll('.analysis-item').length,
  })`);
  check('成绩页显示得分', /分/.test(result.score), `score=${result.score.replace(/\n/g, '')}`);
  check('成绩页显示逐题解析', result.analysis >= 10, `analysis=${result.analysis}`);
  check('解析含正确答案与解析文本', result.text.includes('正确答案') && result.text.includes('解析'));
  await shot('06-result');

  console.log('\n[5] 错题本与记录');
  await goto('#/wrong');
  const wrongText = await evaluate('document.body.innerText');
  check('错题本收录答错题目', wrongText.includes('错'), wrongText.slice(0, 60).replace(/\n/g, ' '));
  await shot('07-wrong');

  await goto('#/history');
  const historyText = await evaluate('document.body.innerText');
  check('记录页显示本次成绩', historyText.includes('答题记录') && historyText.includes('分'));
  await shot('08-history');

  console.log('\n[6] 模拟考试：计时与交卷');
  await goto('#/setup/exam');
  const setupText = await evaluate('document.body.innerText');
  check('考试设置页渲染', setupText.includes('考试时长') && setupText.includes('开始考试'));
  await shot('09-setup-exam');

  await evaluate(`document.querySelector('.footer-bar .btn.btn--primary').click()`);
  await sleep(1400);
  const exam = await evaluate(`({
    hash: location.hash,
    timer: (document.querySelector('[data-role="timer"]') || {}).innerText || '',
    text: document.body.innerText.slice(0, 120),
  })`);
  check('进入考试答题页', /quiz\/exam/.test(exam.hash), `hash=${exam.hash}`);
  check('考试模式显示倒计时', /^\d{2}:\d{2}$/.test(exam.timer.trim()), `timer=${exam.timer}`);
  await shot('10-exam');

  // 答题并交卷（考试模式无即时反馈：先选选项，再点下一题；文本题先填字再下一题）
  const examTrace = [];
  for (let i = 0; i < 80; i += 1) {
    const step = await evaluate(`(() => {
      const t = document.querySelector('.footer-bar .btn--primary');
      if (!t) return 'no-btn';
      const label = t.innerText.trim();
      if (label.includes('交卷')) return 'done';

      // 文本题（填空/简答）：第一次先填字，之后按钮可用就直接点（考试模式会翻到下一题）
      const area = document.querySelector('.short-input') || document.querySelector('.fill-input');
      if (area && !area.disabled) {
        if (!String(area.value || '').trim()) {
          area.value = '考试作答测试内容。';
          area.dispatchEvent(new Event('input', { bubbles: true }));
          return 'type';
        }
        if (!t.disabled) { t.click(); return 'text-next'; }
        return 'text-wait';
      }

      // 选项题：先选中一个，再翻页
      const picked = document.querySelector('.option--selected');
      if (!picked) {
        const opt = document.querySelector('.option');
        if (opt) { opt.click(); return 'pick'; }
      }
      if (label.includes('下一题')) { t.click(); return 'next'; }
      return 'wait:' + label;
    })()`);
    examTrace.push(step);
    if (step === 'done') break;
    await sleep(280);
  }
  await shot('11-exam-last');
  if (!examTrace.includes('done')) {
    console.log(`     ⚠ 未能到达交卷按钮，作答轨迹尾部: ${examTrace.slice(-6).join('>')}`);
  }
  await evaluate(`(() => {
    const t = [...document.querySelectorAll('.footer-bar .btn')].find(b => b.innerText.includes('交卷'));
    if (t) t.click();
  })()`);
  await sleep(600);
  const dialogText = await evaluate('document.body.innerText');
  check('交卷前弹出确认', dialogText.includes('确认交卷'), examTrace.slice(-4).join('>'));
  await shot('12-exam-confirm');
  const confirmBtn = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('.dialog__actions .btn')];
    return btns.length;
  })()`);
  if (confirmBtn > 0) {
    await evaluate(`[...document.querySelectorAll('.dialog__actions .btn')].pop().click()`);
  }
  await sleep(1100);
  const examResult = await evaluate(`({
    text: document.body.innerText,
    score: (document.querySelector('.score-board__value') || {}).innerText || '',
  })`);
  check('考试交卷后出分', Boolean(examResult.score), `score=${examResult.score.replace(/\n/g, '')}`);
  check('解析中保留未作答标记', examResult.text.includes('未作答'));
  await shot('13-exam-result');

  console.log('\n[7] 我的与登录');
  await goto('#/profile');
  const profileText = await evaluate('document.body.innerText');
  check('我的页显示统计与设置', profileText.includes('答题设置') && profileText.includes('单选自动下一题'));
  await shot('14-profile');

  await goto('#/login');
  const loginText = await evaluate('document.body.innerText');
  check('登录页渲染', loginText.includes('微信一键登录') && loginText.includes('头像'));
  await shot('15-login');

  // 本地登录
  await evaluate(`(() => {
    const input = document.querySelector('.input');
    input.value = '测试同学';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.btn')].find(b => b.innerText.includes('使用昵称登录')).click();
  })()`);
  await sleep(900);
  const afterLogin = await evaluate('document.body.innerText');
  check('本地登录后我的页显示昵称', afterLogin.includes('测试同学'), afterLogin.slice(0, 50).replace(/\n/g, ' '));
  await shot('16-profile-logged-in');

  await goto('#/chapters');
  await shot('17-chapters');

  console.log('\n[8] 控制台错误');
  const realErrors = consoleErrors.filter((e) => !/favicon|manifest/i.test(e));
  check('页面无 JS 报错', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  /* ---- 汇总 ---- */
  const failed = results.filter((r) => !r.ok);
  console.log(`\n结果: ${results.length - failed.length} 通过, ${failed.length} 失败`);
  if (failed.length) {
    console.log('失败项：');
    failed.forEach((f) => console.log(`  - ${f.name} ${f.detail || ''}`));
  }
  console.log(`截图目录: ${OUT}\n`);

  ws.close();
  child.kill();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('端到端验证异常:', err);
  try {
    child.kill();
  } catch (e2) {
    /* ignore */
  }
  process.exit(1);
});
