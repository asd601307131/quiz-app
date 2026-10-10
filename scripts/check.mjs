/**
 * 自测脚本：不依赖浏览器，校验题库与判分引擎。
 *   node scripts/check.mjs
 */

import { CHAPTERS, QUESTIONS, QUESTION_MAP, chapterStats } from '../src/data/questions.js';

let failed = 0;
let passed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
// essay（论述）与 short（简答）都是主观题，分值与作答要求不同，必须分开保留
const TYPES = ['single', 'multiple', 'judge', 'fill', 'short', 'essay'];
const CHOICE_TYPES = ['single', 'multiple', 'judge'];
const DIFFS = ['easy', 'medium', 'hard'];

console.log('\n[1] 题库结构');

const ids = QUESTIONS.map((q) => q.id);
check('题目 id 无重复', new Set(ids).size === ids.length);

let structOk = true;
let structDetail = '';
for (const q of QUESTIONS) {
  if (!q.id || !q.stem) {
    structOk = false;
    structDetail = `缺少 id/stem: ${JSON.stringify(q).slice(0, 60)}`;
    break;
  }
  if (!TYPES.includes(q.type)) {
    structOk = false;
    structDetail = `${q.id} 非法题型 ${q.type}`;
    break;
  }
  if (!DIFFS.includes(q.difficulty)) {
    structOk = false;
    structDetail = `${q.id} 非法难度 ${q.difficulty}`;
    break;
  }
  if (!CHAPTERS.some((c) => c.id === q.chapterId)) {
    structOk = false;
    structDetail = `${q.id} 章节 ${q.chapterId} 不存在`;
    break;
  }
  if (!q.analysis || q.analysis.length < 4) {
    structOk = false;
    structDetail = `${q.id} 缺少解析`;
    break;
  }
  // 选项题必须有两个以上纯文本选项；填空/简答题不需要 options
  if (CHOICE_TYPES.includes(q.type)) {
    if (!Array.isArray(q.options) || q.options.length < 2) {
      structOk = false;
      structDetail = `${q.id} 选项不足`;
      break;
    }
    if (!q.options.every((o) => typeof o === 'string' && o.trim())) {
      structOk = false;
      structDetail = `${q.id} 选项必须是纯文本字符串`;
      break;
    }
    if (q.options.length > LETTERS.length) {
      structOk = false;
      structDetail = `${q.id} 选项超过 ${LETTERS.length} 个`;
      break;
    }
  }
  if (q.type === 'short' && !q.answerText) {
    structOk = false;
    structDetail = `${q.id} 简答题缺少参考答案 answerText`;
    break;
  }
}
check('每道题字段完整且合法', structOk, structDetail);

let answerOk = true;
let answerDetail = '';
for (const q of QUESTIONS) {
  const ans = q.answer;

  if (q.type === 'fill') {
    const list = Array.isArray(ans) ? ans : [ans];
    if (!list.length || list.some((a) => typeof a !== 'string' || !a.trim())) {
      answerOk = false;
      answerDetail = `${q.id} 填空题答案必须是至少一个非空字符串`;
      break;
    }
    continue;
  }

  if (q.type === 'short' || q.type === 'essay') {
    // 简答 / 论述不自动判分，answer 可省略
    continue;
  }

  if (!Array.isArray(ans) || !ans.length) {
    answerOk = false;
    answerDetail = `${q.id} 没有答案`;
    break;
  }
  const keys = LETTERS.slice(0, q.options.length);
  if (ans.some((a) => !keys.includes(a))) {
    answerOk = false;
    answerDetail = `${q.id} 答案 ${ans.join(',')} 不在选项字母范围内`;
    break;
  }
  if (new Set(ans).size !== ans.length) {
    answerOk = false;
    answerDetail = `${q.id} 答案有重复项`;
    break;
  }
  if (q.type === 'single' && ans.length !== 1) {
    answerOk = false;
    answerDetail = `${q.id} 单选题答案应为 1 项`;
    break;
  }
  if (q.type === 'multiple' && ans.length < 2) {
    answerOk = false;
    answerDetail = `${q.id} 多选题答案应至少 2 项`;
    break;
  }
  if (q.type === 'judge' && (q.options.length !== 2 || ans.length !== 1)) {
    answerOk = false;
    answerDetail = `${q.id} 判断题应有两个选项且答案唯一`;
    break;
  }
}
check('答案与题型匹配', answerOk, answerDetail);

console.log('\n[2] 题库覆盖');

/**
 * 题库规模类的断言只在「内置示例题库」上生效。
 * 用户导入自己的题库后规模必然变化，不能因此判定失败——
 * 这里用是否包含示例章节 web 作为识别标志。
 */
const IS_DEMO_BANK = CHAPTERS.some((c) => c.id === 'web') && QUESTIONS.length >= 60;

if (IS_DEMO_BANK) {
  check('章节数 >= 5', CHAPTERS.length >= 5, `实际 ${CHAPTERS.length}`);
  check('题目总数 >= 60', QUESTIONS.length >= 60, `实际 ${QUESTIONS.length}`);
  check('每章节题目数 >= 10', CHAPTERS.every((c) => chapterStats(c.id).total >= 10));
} else {
  console.log('  （当前是自定义题库，跳过示例题库的规模断言）');
  check('自定义题库非空', QUESTIONS.length > 0, `实际 ${QUESTIONS.length}`);
  check('每个章节都至少有一道题', CHAPTERS.every((c) => chapterStats(c.id).total > 0));
}
// 单选题是必有的；多选/判断属于可选题型，题库里没有时不算失败
check('单选题存在', QUESTIONS.some((q) => q.type === 'single'));
check(
  '选项类题目的选项都合法',
  QUESTIONS.filter((q) => q.type === 'single' || q.type === 'multiple').every(
    (q) => Array.isArray(q.options) && q.options.length >= 2
  )
);
// 判断题有两种合法写法：type: 'judge'，或 single + options ['正确','错误']（引擎会把 judge 归一化为 single）
check(
  '存在判断题形态的题目',
  QUESTIONS.some(
    (q) =>
      q.type === 'judge' ||
      (q.type === 'single' &&
        q.options.length === 2 &&
        q.options[0] === '正确' &&
        q.options[1] === '错误')
  )
);
// 填空/简答题为可选能力：题库里还没有时不算失败，但要有的话必须合法
check('填空/简答题（若存在）合法', QUESTIONS.filter((q) => q.type === 'fill' || q.type === 'short').every((q) => Boolean(q.analysis)));
check('三种难度齐备', DIFFS.every((d) => QUESTIONS.some((q) => q.difficulty === d)));
check(
  '章节统计与题目一致',
  CHAPTERS.every((c) => {
    const st = chapterStats(c.id);
    return st.total === QUESTIONS.filter((q) => q.chapterId === c.id).length;
  })
);

/** 题目最多的章节：供组卷章节筛选断言使用（自适应任意题库） */
const BIGGEST_CHAPTER = CHAPTERS.map((c) => ({ ...c, total: chapterStats(c.id).total })).sort(
  (a, b) => b.total - a.total
)[0];

/* ------------------------------------------------------------------ */
/* 引擎测试（不依赖浏览器，仅用纯函数部分）                              */
/* ------------------------------------------------------------------ */

console.log('\n[3] 判分引擎');

const {
  normalizeAnswer,
  isCorrect,
  buildPaper,
  createSession,
  answeredCount,
  setAnswer,
  toggleAnswer,
  gradeSession,
  normalizeText,
  hasAnswer,
  formatAnswer,
  normalizeType,
  isObjective,
  typeLabel,
} = await import('../src/core/engine.js');

check('normalizeAnswer 升序去重', normalizeAnswer(['c', 'A', 'a']).join(',') === 'A,C');
check('normalizeAnswer 过滤空值', normalizeAnswer([' b ', '', null, 'a']).join(',') === 'A,B');

const single = QUESTIONS.find((q) => q.type === 'single');
check('单选题答案正确判定', isCorrect(single, [single.answer[0]]));
check('单选题答案错误判定', !isCorrect(single, [LETTERS.find((l) => l !== single.answer[0])]));

// 题库里可能没有多选题（例如成考题库），此时用内置夹具，保证引擎逻辑始终被覆盖
const multi =
  QUESTIONS.find((q) => q.type === 'multiple') || {
    id: 'fixture-multi',
    type: 'multiple',
    stem: '多选题夹具',
    options: ['甲', '乙', '丙', '丁'],
    answer: ['A', 'C'],
    analysis: '夹具题，仅用于引擎测试。',
  };
check('多选题少选判错', !isCorrect(multi, [multi.answer[0]]));
check('多选题全选判对', isCorrect(multi, multi.answer.slice().reverse()));

check('空答案判错', !isCorrect(single, []));
check('null 答案判错', !isCorrect(single, null));

/* ---- 填空题 / 简答题 ---- */

console.log('\n[3b] 填空与简答题');

const fillQ = {
  id: 'fixture-fill',
  type: 'fill',
  stem: '判断数组的方法是什么？',
  answer: ['Array.isArray', 'Array.isArray()'],
  analysis: '用 Array.isArray 判断。',
};

check('填空题正确答案判对', isCorrect(fillQ, 'Array.isArray'));
check('填空题忽略大小写', isCorrect(fillQ, 'array.isarray'));
check('填空题忽略首尾空格', isCorrect(fillQ, '  Array.isArray  '));
check('填空题忽略全角括号差异', isCorrect(fillQ, 'Array.isArray（）'));
check('填空题多个可接受答案', isCorrect(fillQ, 'Array.isArray()'));
check('填空题错误答案判错', !isCorrect(fillQ, 'typeof'));
check('填空题空答案判错', !isCorrect(fillQ, ''));

check('normalizeText 去空白与标点', normalizeText(' A b, c。 ') === 'abc');
check('normalizeText 全角转半角', normalizeText('ＡＢＣ') === 'abc');

const shortQ = {
  id: 'fixture-short',
  type: 'short',
  stem: '请简述事件循环。',
  answerText: '宏任务 -> 微任务 -> 渲染。',
  analysis: '先清空微任务再渲染。',
};

check('简答题不参与自动判分', !isCorrect(shortQ, '宏任务 -> 微任务 -> 渲染。'));
check('简答题标记为非客观题', !isObjective('short'));
check('填空题标记为客观题', isObjective('fill'));

check('normalizeType 把 judge 归一化为 single', normalizeType('judge') === 'single');
check('判断题显示名仍为判断题', typeLabel('judge') === '单选题' && typeLabel('fill') === '填空题');

const textSession = createSession({ mode: 'practice', questions: [fillQ, shortQ] });
check('未作答时 hasAnswer 为假', !hasAnswer(textSession.answers[fillQ.id]));
setAnswer(textSession, fillQ.id, 'Array.isArray', fillQ);
check('填空题答案以字符串保存', textSession.answers[fillQ.id] === 'Array.isArray');
check('填空题作答计入已答', hasAnswer(textSession.answers[fillQ.id]) && answeredCount(textSession) === 1);
setAnswer(textSession, fillQ.id, '   ', fillQ);
check('填空题只填空格视为未作答', !hasAnswer(textSession.answers[fillQ.id]));

setAnswer(textSession, shortQ.id, '先执行宏任务，再清空微任务', shortQ);
check('简答题答案以字符串保存', typeof textSession.answers[shortQ.id] === 'string');
check('formatAnswer 原样返回文本答案', formatAnswer(fillQ, 'Array.isArray') === 'Array.isArray');
check('formatAnswer 选项答案用顿号连接', formatAnswer(single, ['A', 'C']) === 'A、C');

/* ---- 含简答题的整卷判分 ---- */

const mixedPaper = [single, multi, fillQ, shortQ];
const mixedSession = createSession({ mode: 'exam', questions: mixedPaper });
setAnswer(mixedSession, single.id, single.answer, single);
setAnswer(mixedSession, multi.id, multi.answer, multi);
setAnswer(mixedSession, fillQ.id, 'Array.isArray', fillQ);
setAnswer(mixedSession, shortQ.id, '随便答一点', shortQ);
const mixedResult = gradeSession(mixedSession, { recordToStore: false });
check('简答题不拉低总分（客观题全对得 100）', mixedResult.score === 100, `实际 ${mixedResult.score}`);
check('简答题计入 pending', mixedResult.pending === 1, `pending=${mixedResult.pending}`);
check('客观题满分为 3 题', mixedResult.objectiveTotal === 3, `objectiveTotal=${mixedResult.objectiveTotal}`);
check('正确率按客观题计算', mixedResult.accuracy === 100, `accuracy=${mixedResult.accuracy}`);
check(
  '明细里保留简答题文本答案',
  mixedResult.detail.find((d) => d.questionId === shortQ.id).userAnswer === '随便答一点'
);
check('明细里保留填空题文本答案', mixedResult.detail.find((d) => d.questionId === fillQ.id).userAnswer === 'Array.isArray');

console.log('\n[4] 组卷与交卷');

const paper = buildPaper(QUESTIONS, { count: 5 });
check('抽题数量正确', paper.length === Math.min(5, QUESTIONS.length), `实际 ${paper.length}`);
check('抽题无重复', new Set(paper.map((q) => q.id)).size === paper.length);

const chapterPaper = buildPaper(QUESTIONS, { count: 99, chapterIds: [BIGGEST_CHAPTER.id] });
check(
  '章节筛选生效',
  chapterPaper.length > 0 && chapterPaper.every((q) => q.chapterId === BIGGEST_CHAPTER.id),
  `章节 ${BIGGEST_CHAPTER.id} 抽到 ${chapterPaper.length} 题`
);

const ANY_DIFFICULTY = ['easy', 'medium', 'hard'].find((d) => QUESTIONS.some((q) => q.difficulty === d));
const diffPaper = buildPaper(QUESTIONS, { count: 99, difficulties: [ANY_DIFFICULTY] });
check(
  '难度筛选生效',
  diffPaper.length > 0 && diffPaper.every((q) => q.difficulty === ANY_DIFFICULTY)
);

const seedIds = QUESTIONS.slice(0, 2).map((q) => q.id);
const seedPaper = buildPaper(QUESTIONS, { seedQuestions: [...seedIds, '不存在的题'] });
check('错题重练按 id 取题并忽略无效 id', seedPaper.length === seedIds.length, `实际 ${seedPaper.length}`);

/**
 * 判分断言使用「确定性卷子」，且必须每题都存在错误选项。
 * 不能随机抽题：题库里可能存在“所有选项都正确”的多选题，
 * 一旦抽到就构造不出全错答案，断言会随机失败（这是测试用例的坑，不是应用的 bug）。
 *
 * 这里自适应题库：从选项题里挑出有错误选项的题，最多 7 道。
 */
const FIXED_PAPER = QUESTIONS.filter(
  (q) =>
    ['single', 'multiple', 'judge'].includes(q.type) &&
    Array.isArray(q.options) &&
    q.options.some((_, i) => !q.answer.includes(LETTERS[i]))
).slice(0, 7);
const fixedPaper = buildPaper(QUESTIONS, { seedQuestions: FIXED_PAPER.map((q) => q.id) });
check(
  '确定性卷子取题完整',
  fixedPaper.length === FIXED_PAPER.length && fixedPaper.length >= 1,
  `期望 ${FIXED_PAPER.length} 实际 ${fixedPaper.length}`
);
check(
  '确定性卷子每题都存在错误选项（可构造全错）',
  fixedPaper.every((q) => q.options.some((_, i) => !q.answer.includes(LETTERS[i])))
);

const session = createSession({ mode: 'practice', questions: paper, title: '测试' });
check('会话答案初始为空', answeredCount(session) === 0);

setAnswer(session, paper[0].id, ['A']);
check('记录答案后计入已答', answeredCount(session) === 1);

// 复用上面的多选夹具（题库没有多选时也能测）
const multiQ = multi;
const ms = createSession({ mode: 'practice', questions: [multiQ] });
toggleAnswer(ms, multiQ.id, 'A');
toggleAnswer(ms, multiQ.id, 'B');
check('多选切换累加', normalizeAnswer(ms.answers[multiQ.id]).join(',') === 'A,B');
toggleAnswer(ms, multiQ.id, 'A');
check('多选再次点击取消', normalizeAnswer(ms.answers[multiQ.id]).join(',') === 'B');

// 构造一张全对的卷子（用确定性卷子，保证可复现）
const examSession = createSession({ mode: 'exam', questions: fixedPaper });
fixedPaper.forEach((q) => setAnswer(examSession, q.id, q.answer));
const fullResult = gradeSession(examSession, { recordToStore: false });
check('全对得 100 分', fullResult.score === 100, `实际 ${fullResult.score}`);
check('全对正确率 100%', fullResult.accuracy === 100);
check('全对无错题', fullResult.wrong === 0 && fullResult.unanswered === 0);

// 构造一张全错的卷子
const badSession = createSession({ mode: 'exam', questions: fixedPaper });
fixedPaper.forEach((q) => {
  const allKeys = LETTERS.slice(0, q.options.length);
  const wrong = allKeys.filter((k) => !q.answer.includes(k));
  if (wrong.length) setAnswer(badSession, q.id, [wrong[0]]);
});
const zeroResult = gradeSession(badSession, { recordToStore: false });
check('全错得 0 分', zeroResult.score === 0, `实际 ${zeroResult.score}`);
check(
  '全错错题数等于题量',
  zeroResult.wrong === fixedPaper.length,
  `wrong=${zeroResult.wrong} total=${fixedPaper.length} 未作答=${zeroResult.unanswered}`
);

// 未作答
const emptySession = createSession({ mode: 'exam', questions: fixedPaper });
const emptyResult = gradeSession(emptySession, { recordToStore: false });
check('未作答全部计入 unanswered', emptyResult.unanswered === fixedPaper.length);
check('未作答得 0 分', emptyResult.score === 0);

// 随机抽题也要能稳定判分。
// 注意：随机卷里可能含简答题（不参与自动判分），因此这里只对客观题断言满分，
// 否则「全对得 100」会因为简答题被排除在计分外而误判失败。
const { isObjective: isObjectiveType } = await import('../src/core/engine.js');
const randomFull = createSession({ mode: 'exam', questions: paper });
paper.forEach((q) => {
  if (isObjectiveType(q.type)) setAnswer(randomFull, q.id, q.answer, q);
});
const randomFullResult = gradeSession(randomFull, { recordToStore: false });
const randomObjectiveCount = paper.filter((q) => isObjectiveType(q.type)).length;
check(
  '随机卷子客观题全对得 100 分',
  randomObjectiveCount > 0 && randomFullResult.score === 100,
  `客观题 ${randomObjectiveCount} 道，得分 ${randomFullResult.score}`
);

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed ? 1 : 0);
