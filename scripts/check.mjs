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
const TYPES = ['single', 'multiple', 'judge'];
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
  // 选项字母由顺序派生，这里只校验数量与答案字母的取值范围一致
  const keys = LETTERS.slice(0, q.options.length);
  if (q.options.length !== keys.length) {
    structOk = false;
    structDetail = `${q.id} 选项数量异常`;
    break;
  }
  if (!q.analysis || q.analysis.length < 4) {
    structOk = false;
    structDetail = `${q.id} 缺少解析`;
    break;
  }
}
check('每道题字段完整且合法', structOk, structDetail);

let answerOk = true;
let answerDetail = '';
for (const q of QUESTIONS) {
  const ans = q.answer;
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

check('章节数 >= 5', CHAPTERS.length >= 5, `实际 ${CHAPTERS.length}`);
check('题目总数 >= 60', QUESTIONS.length >= 60, `实际 ${QUESTIONS.length}`);
check('每章节题目数 >= 10', CHAPTERS.every((c) => chapterStats(c.id).total >= 10));
check('三种题型齐备', TYPES.every((t) => QUESTIONS.some((q) => q.type === t)));
check('三种难度齐备', DIFFS.every((d) => QUESTIONS.some((q) => q.difficulty === d)));
check(
  '章节统计与题目一致',
  CHAPTERS.every((c) => {
    const st = chapterStats(c.id);
    return st.total === QUESTIONS.filter((q) => q.chapterId === c.id).length;
  })
);

/* ------------------------------------------------------------------ */
/* 引擎测试（不依赖浏览器，仅用纯函数部分）                              */
/* ------------------------------------------------------------------ */

console.log('\n[3] 判分引擎');

const { normalizeAnswer, isCorrect, buildPaper, createSession, answeredCount, setAnswer, toggleAnswer, gradeSession } =
  await import('../src/core/engine.js');

check('normalizeAnswer 升序去重', normalizeAnswer(['c', 'A', 'a']).join(',') === 'A,C');
check('normalizeAnswer 过滤空值', normalizeAnswer([' b ', '', null, 'a']).join(',') === 'A,B');

const single = QUESTIONS.find((q) => q.type === 'single');
check('单选题答案正确判定', isCorrect(single, [single.answer[0]]));
check('单选题答案错误判定', !isCorrect(single, [LETTERS.find((l) => l !== single.answer[0])]));

const multi = QUESTIONS.find((q) => q.type === 'multiple');
check('多选题少选判错', !isCorrect(multi, [multi.answer[0]]));
check('多选题全选判对', isCorrect(multi, multi.answer.slice().reverse()));

check('空答案判错', !isCorrect(single, []));
check('null 答案判错', !isCorrect(single, null));

console.log('\n[4] 组卷与交卷');

const paper = buildPaper(QUESTIONS, { count: 5 });
check('抽题数量正确', paper.length === 5);
check('抽题无重复', new Set(paper.map((q) => q.id)).size === 5);

const chapterPaper = buildPaper(QUESTIONS, { count: 99, chapterIds: ['js'] });
check(
  '章节筛选生效',
  chapterPaper.length > 0 && chapterPaper.every((q) => q.chapterId === 'js')
);

const diffPaper = buildPaper(QUESTIONS, { count: 99, difficulties: ['hard'] });
check(
  '难度筛选生效',
  diffPaper.length > 0 && diffPaper.every((q) => q.difficulty === 'hard')
);

const seedPaper = buildPaper(QUESTIONS, { seedQuestions: ['js-01', 'css-01', '不存在的题'] });
check('错题重练按 id 取题并忽略无效 id', seedPaper.length === 2);

const session = createSession({ mode: 'practice', questions: paper, title: '测试' });
check('会话答案初始为空', answeredCount(session) === 0);

setAnswer(session, paper[0].id, ['A']);
check('记录答案后计入已答', answeredCount(session) === 1);

const multiQ = QUESTIONS.find((q) => q.type === 'multiple');
const ms = createSession({ mode: 'practice', questions: [multiQ] });
toggleAnswer(ms, multiQ.id, 'A');
toggleAnswer(ms, multiQ.id, 'B');
check('多选切换累加', normalizeAnswer(ms.answers[multiQ.id]).join(',') === 'A,B');
toggleAnswer(ms, multiQ.id, 'A');
check('多选再次点击取消', normalizeAnswer(ms.answers[multiQ.id]).join(',') === 'B');

// 构造一张全对的卷子
const examSession = createSession({ mode: 'exam', questions: paper });
paper.forEach((q) => setAnswer(examSession, q.id, q.answer));
const fullResult = gradeSession(examSession, { recordToStore: false });
check('全对得 100 分', fullResult.score === 100, `实际 ${fullResult.score}`);
check('全对正确率 100%', fullResult.accuracy === 100);
check('全对无错题', fullResult.wrong === 0 && fullResult.unanswered === 0);

// 构造一张全错的卷子
const badSession = createSession({ mode: 'exam', questions: paper });
paper.forEach((q) => {
  const allKeys = LETTERS.slice(0, q.options.length);
  const wrong = allKeys.filter((k) => !q.answer.includes(k));
  if (wrong.length) setAnswer(badSession, q.id, [wrong[0]]);
});
const zeroResult = gradeSession(badSession, { recordToStore: false });
check('全错得 0 分', zeroResult.score === 0, `实际 ${zeroResult.score}`);
check(
  '全错错题数等于题量',
  zeroResult.wrong === paper.length,
  `wrong=${zeroResult.wrong} total=${paper.length} 未作答=${zeroResult.unanswered}`
);

// 未作答
const emptySession = createSession({ mode: 'exam', questions: paper });
const emptyResult = gradeSession(emptySession, { recordToStore: false });
check('未作答全部计入 unanswered', emptyResult.unanswered === paper.length);
check('未作答得 0 分', emptyResult.score === 0);

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed ? 1 : 0);
