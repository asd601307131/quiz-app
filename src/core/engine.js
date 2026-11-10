/**
 * 判分与组卷引擎。
 * 纯函数，不依赖 DOM，可单独用于 Node 端自测。
 */

import { shuffle, percent, uid } from './utils.js';
import * as store from './store.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export const DIFFICULTIES = {
  easy: { key: 'easy', label: '简单', color: 'green' },
  medium: { key: 'medium', label: '中等', color: 'orange' },
  hard: { key: 'hard', label: '困难', color: 'red' },
};

/**
 * 题型（与电工技能等级认定题库一致，共 5 类）。
 *
 *   key       题型标识
 *   label     界面上显示的名称
 *   objective 是否可自动判分（决定是否参与算分分母）
 *   paper     是否可进入「章节练习 / 随机组卷 / 模拟考试」
 *   input     作答方式：'choice' 选项按钮 / 'text' 文本框
 */
export const TYPES = {
  single: { key: 'single', label: '单选题', objective: true, paper: true, input: 'choice' },
  multiple: { key: 'multiple', label: '多选题', objective: true, paper: true, input: 'choice' },
  judge: { key: 'judge', label: '判断题', objective: true, paper: true, input: 'choice' },
  short: { key: 'short', label: '简答题', objective: false, paper: false, input: 'text' },
  essay: { key: 'essay', label: '论述题', objective: false, paper: false, input: 'text' },
};

/** 题库使用的全部题型（顺序即界面展示顺序） */
export const TYPE_ORDER = ['single', 'multiple', 'judge', 'short', 'essay'];

/** 兼容历史数据里的题型别名（旧库用过 fill / 填空，现已不再支持） */
const LEGACY_TYPE_ALIAS = {
  single: 'single',
  multiple: 'multiple',
  judge: 'judge',
  short: 'short',
  essay: 'essay',
};

/**
 * 归一化题型名。未知题型退回单选，保证渲染不崩。
 * 注意：判断题保持 judge，不再折叠成 single（否则界面上会显示错题型）。
 */
export function normalizeType(type) {
  const raw = typeof type === 'string' ? type : type && type.type;
  return LEGACY_TYPE_ALIAS[raw] || 'single';
}

/** 取题型配置 */
function typeMeta(questionOrType) {
  return TYPES[normalizeType(questionOrType)];
}

/**
 * 是否属于"可自动判分"的题型（用于算分分母、即时反馈）。
 * 单选题、多选题、判断题都可自动判分。
 */
export function isObjective(question) {
  return typeMeta(question).objective;
}

/** 是否进得了「章节练习 / 随机组卷 / 模拟考试」——上述三类客观题都可以 */
export function isPaperEligible(question) {
  return typeMeta(question).paper;
}

/** 是否为主观题（简答 / 论述）——只作为解析与得分点参考，不参与判分 */
export function isSubjective(question) {
  return !isObjective(question);
}

/**
 * 是否用「文本框」作答（简答 / 论述）。
 * 视图层据此决定渲染选项按钮还是输入框，避免各处重复写死题型判断。
 */
export function isTextInput(question) {
  return typeMeta(question).input === 'text';
}

/** 是否用「选项按钮」作答（单选 / 多选 / 判断） */
export function isChoiceInput(question) {
  return typeMeta(question).input === 'choice';
}

export function typeLabel(type) {
  return TYPES[normalizeType(type)].label;
}

const MAX_SCORE = 100;

/* ------------------------------------------------------------------ */
/* 判分                                                                */
/* ------------------------------------------------------------------ */

/**
 * 选项题答案统一为“升序去重”的字母数组。
 * 只接受字符串，null/undefined 一律剔除。
 */
export function normalizeAnswer(answer) {
  if (answer == null) return [];
  const list = Array.isArray(answer) ? answer : [answer];
  return [
    ...new Set(
      list
        .filter((v) => v != null)
        .map((v) => String(v).trim().toUpperCase())
        .filter(Boolean)
    ),
  ].sort();
}

/**
 * 文本答案的宽松归一化：去掉所有空白、统一大小写、
 * 全角转半角、去掉常见中英文标点，避免“写法略有差异”被判错。
 * 目前用于文字题的答案对照（简答/论述不自动判分，保留该工具供扩展）。
 */
export function normalizeText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)) // 全角转半角
    .replace(/\u3000/g, ' ') // 全角空格
    .replace(/[\s]+/g, '')
    .toLowerCase()
    .replace(/[。，、；：？！“”‘’（）《》【】,.!?;:'"()<>\[\]]/g, '');
}

/** 选项题比较 */
function sameChoiceAnswer(a, b) {
  const x = normalizeAnswer(a);
  const y = normalizeAnswer(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * 判断单题对错。
 * - 选项题（单选/多选/判断）：多选与判断采用“全对才得分”
 * - 简答/论述：无法自动判分，恒返回 false，由上层标记为待自评
 */
export function isCorrect(question, userAnswer) {
  if (isTextInput(question)) return false;
  return sameChoiceAnswer(question.answer, userAnswer);
}

/* ------------------------------------------------------------------ */
/* 组卷                                                                */
/* ------------------------------------------------------------------ */

/**
 * 随机抽题组卷。
 * @param {Array} pool 题库
 * @param {object} opts { count, chapterIds, difficulties, seedQuestions, onlyObjective }
 */
export function buildPaper(pool, opts = {}) {
  const {
    count = 10,
    chapterIds = null,
    difficulties = null,
    seedQuestions = null,
    onlyObjective = false,
  } = opts;
  let candidates = pool.slice();

  if (onlyObjective) {
    // 练习/考试卷只出客观题（简答、论述主观题不参与组卷）
    candidates = candidates.filter((q) => isPaperEligible(q));
  }

  if (seedQuestions && seedQuestions.length) {
    // 错题重练：按给定题目顺序出卷
    const byId = new Map(pool.map((q) => [q.id, q]));
    candidates = seedQuestions
      .map((s) => byId.get(typeof s === 'string' ? s : s.questionId))
      .filter(Boolean);
  } else {
    if (chapterIds && chapterIds.length) {
      candidates = candidates.filter((q) => chapterIds.includes(q.chapterId));
    }
    if (difficulties && difficulties.length) {
      candidates = candidates.filter((q) => difficulties.includes(q.difficulty));
    }
  }

  return shuffle(candidates).slice(0, Math.min(count, candidates.length));
}

/**
 * 考卷模块顺序与配比。
 * 按电工技能等级认定的常规命题结构设定：
 *   电工基础占比最大，其次是自动化控制与电机变压器，
 *   电气安全与职业素养作为必得分放在后面。
 */
export const PAPER_MODULES = [
  { key: '电工基础', label: '电工基础', quota: 12, prefix: ['elec-basic'] },
  { key: '电机与变压器', label: '电机与变压器', quota: 8, prefix: ['elec-machine'] },
  { key: '自动化与控制', label: '自动化与控制', quota: 10, prefix: ['elec-auto'] },
  { key: '电气安全', label: '电气安全', quota: 6, prefix: ['elec-safety'] },
  { key: '职业素养', label: '职业素养', quota: 4, prefix: ['elec-ethics'] },
];

/** 判断某章节属于哪个模块（按 PAPER_MODULES 顺序匹配） */
export function moduleOfChapter(chapterId) {
  for (const m of PAPER_MODULES) {
    if (m.prefix.some((p) => chapterId === p || chapterId.startsWith(p))) return m.key;
  }
  return null;
}

/**
 * 取题目所属模块：优先用题目自带的 module 字段（真题转录时标注），
 * 没有则按章节推断。
 */
export function moduleOfQuestion(q) {
  if (q && q.module) {
    const hit = PAPER_MODULES.find((m) => m.key === q.module);
    if (hit) return hit.key;
  }
  return moduleOfChapter(q ? q.chapterId : '');
}

/**
 * 按真卷模块结构组卷：模块顺序固定，题量按各模块在真卷中的占比分配。
 *
 * 配比见下方 PAPER_MODULES（电工基础 12 / 电机 8 / 自动化 10 / 安全 6 / 素养 4）。
 * 某模块题量不足时，缺口由其他模块补齐，但**最终仍按模块顺序排列**，
 * 保证卷面结构与真卷一致（不会出现"做着做着又回到马哲"）。
 *
 * @param {Array} pool 已限定科目/章节/难度的题池
 * @param {number} count 总题量
 */
export function buildStructuredPaper(pool, count = 35) {
  const objective = pool.filter((q) => isPaperEligible(q));

  // 先按模块分桶（题目自带的 module 字段优先，其次按章节推断）
  const buckets = new Map();
  for (const m of PAPER_MODULES) buckets.set(m.key, []);
  const other = [];
  for (const q of objective) {
    const key = moduleOfQuestion(q);
    if (key && buckets.has(key)) buckets.get(key).push(q);
    else other.push(q);
  }

  const TOTAL = PAPER_MODULES.reduce((a, m) => a + m.quota, 0); // 35
  const scale = count / TOTAL;

  // 第一轮：按配比取题
  const chosen = new Map();
  const spare = [];
  for (const m of PAPER_MODULES) {
    const list = shuffle(buckets.get(m.key));
    const quota = Math.max(0, Math.round(m.quota * scale));
    chosen.set(m.key, list.slice(0, quota));
    spare.push(...list.slice(quota));
  }
  spare.push(...shuffle(other));

  // 第二轮：缺口用剩余题补齐，按模块顺序优先回填到题量最缺的模块
  let picked = PAPER_MODULES.reduce((a, m) => a + chosen.get(m.key).length, 0);
  let cursor = 0;
  while (picked < count && cursor < spare.length) {
    // 找出当前离配额差距最大的模块
    let target = PAPER_MODULES[0];
    let gap = -Infinity;
    for (const m of PAPER_MODULES) {
      const quota = Math.max(0, Math.round(m.quota * scale));
      const g = quota - chosen.get(m.key).length;
      if (g > gap) { gap = g; target = m; }
    }
    chosen.get(target.key).push(spare[cursor]);
    cursor += 1;
    picked += 1;
  }

  // 最终按模块顺序拼装
  const paper = [];
  for (const m of PAPER_MODULES) paper.push(...chosen.get(m.key));
  return paper.slice(0, count);
}

/**
 * 各题型的建议作答时长（分钟）。
 *
 * 依据：电工等级认定理论考试的常见题型与作答量估算——
 *   判断题二选一并需判断，单选读题较快，多选要逐项核对；
 *   简答与论述需要分点书写，耗时明显更长。
 * 练习模式下每题还要读解析，所以取值偏宽松一点点。
 */
export const MINUTES_PER_TYPE = {
  single: 2, // 单选
  judge: 1.5, // 判断题（二选一，较快）
  multiple: 3, // 多选
  short: 9, // 简答：分点作答
  essay: 18, // 论述：摆原理 + 联系实际 + 归纳总结
};

/**
 * 按题型构成估算整套题的建议时长（分钟）。
 * @param {Array} questions 题目列表
 * @param {number} minMinutes 下限，避免题量很少时时长过短
 */
export function estimateMinutes(questions = [], minMinutes = 5) {
  const total = questions.reduce((sum, q) => {
    const type = normalizeType(q.type);
    return sum + (MINUTES_PER_TYPE[type] || MINUTES_PER_TYPE.single);
  }, 0);
  return Math.max(minMinutes, Math.round(total));
}

/**
 * 创建一次答题会话。
 * @param {object} config { mode:'practice'|'exam', pool, questions, chapterId, chapterIds, difficulty, difficulties, durationSec, title }
 */
export function createSession(config) {
  const questions = config.questions || [];
  const durationSec = config.durationSec || 0;
  return {
    id: uid('sess'),
    mode: config.mode === 'exam' ? 'exam' : 'practice',
    title: config.title || (config.mode === 'exam' ? '模拟考试' : '章节练习'),
    chapterId: config.chapterId || null,
    chapterIds: config.chapterIds || null,
    difficulty: config.difficulty || null,
    difficulties: config.difficulties || null,
    questions,
    answers: {}, // questionId -> string[]
    currentIndex: 0,
    startedAt: Date.now(),
    durationSec, // 0 表示不限时
    remainingSec: durationSec,
    estimatedMinutes: estimateMinutes(questions), // 按题型估算的建议时长
    submitted: false,
    result: null,
  };
}

/**
 * 会话中已作答题数。
 * 文字题（简答/论述）的答案是字符串；选项题用字母数组判断。
 */
export function answeredCount(session) {
  return Object.values(session.answers).filter((a) => hasAnswer(a)).length;
}

export function isAnswered(session, questionId) {
  return hasAnswer(session.answers[questionId]);
}

/** 任意形态的答案是否算“已作答” */
export function hasAnswer(answer) {
  if (Array.isArray(answer)) return answer.length > 0;
  if (typeof answer === 'string') return answer.trim().length > 0;
  return false;
}

/** 选项题的默认空值 */
function emptyFor(question) {
  return isTextInput(question) ? '' : [];
}

/** 记录作答（多选题传新数组覆盖；文字题传字符串） */
export function setAnswer(session, questionId, answer, question = null) {
  const type = question ? normalizeType(question.type) : null;

  if (question ? isTextInput(question) : type === 'short' || type === 'essay') {
    // 兼容传数组的调用方式（例如测试或批量回填）：取第一项作为文本
    let text = '';
    if (Array.isArray(answer)) text = answer.length ? String(answer[0]) : '';
    else if (answer != null) text = String(answer);

    if (!text.trim()) delete session.answers[questionId];
    else session.answers[questionId] = text;
    return session;
  }

  if (typeof answer === 'string') {
    // 未指定题型但传了字符串：按字母答案处理
    const list = normalizeAnswer(answer);
    if (!list.length) delete session.answers[questionId];
    else session.answers[questionId] = list;
    return session;
  }

  const list = normalizeAnswer(answer);
  if (!list.length) delete session.answers[questionId];
  else session.answers[questionId] = list;
  return session;
}

/** 切换多选中的某个选项 */
export function toggleAnswer(session, questionId, letter) {
  const cur = normalizeAnswer(session.answers[questionId]);
  const idx = cur.indexOf(letter);
  if (idx >= 0) cur.splice(idx, 1);
  else cur.push(letter);
  return setAnswer(session, questionId, cur);
}

/** 把任意答案渲染成可显示文本，供结果页/错题本使用 */
export function formatAnswer(question, answer) {
  const type = question ? normalizeType(question.type) : null;
  if (question ? isTextInput(question) : type === 'short' || type === 'essay') {
    return typeof answer === 'string' ? answer.trim() : '';
  }
  return normalizeAnswer(answer).join('、');
}

/* ------------------------------------------------------------------ */
/* 交卷判分                                                            */
/* ------------------------------------------------------------------ */

/**
 * 交卷。返回结果对象并写入会话。
 *
 * 计分规则：满分 100，平均分给「参与自动判分的题」（单选/多选/判断）。
 * 简答题不参与自动判分，单独统计为 pending（待人工/自评），
 * 这样题库里混入简答题也不会把整卷总分压低。
 */
export function gradeSession(session, { recordToStore = true, user = null } = {}) {
  const questions = session.questions;
  const detail = [];
  let correct = 0;
  let wrong = 0;
  let unanswered = 0;
  let pending = 0;

  for (const q of questions) {
    const type = normalizeType(q.type);
    const raw = session.answers[q.id];
    const objective = isObjective(type);
    const answered = hasAnswer(raw);

    let ok = false;
    if (objective && answered) ok = isCorrect(q, raw);

    if (!objective) {
      pending += 1;
    } else if (!answered) {
      unanswered += 1;
    } else if (ok) {
      correct += 1;
    } else {
      wrong += 1;
    }

    detail.push({
      questionId: q.id,
      chapterId: q.chapterId,
      difficulty: q.difficulty,
      type,
      objective,
      userAnswer: raw == null ? emptyFor(q) : raw,
      rightAnswer: q.answer,
      correct: ok,
      answered,
      pending: !objective,
    });
  }

  const objectiveTotal = questions.filter((q) => isObjective(q.type)).length;
  const perScore = objectiveTotal ? MAX_SCORE / objectiveTotal : 0;
  const score = Math.round(correct * perScore * 10) / 10;
  const durationSec = Math.max(0, Math.round(((session.submittedAt || Date.now()) - session.startedAt) / 1000));
  const result = {
    sessionId: session.id,
    mode: session.mode,
    total: questions.length,
    objectiveTotal,
    correct,
    wrong,
    unanswered,
    pending,
    score,
    accuracy: percent(correct, objectiveTotal),
    durationSec,
    detail,
    gradedAt: Date.now(),
  };

  session.result = result;
  session.submitted = true;
  session.submittedAt = session.submittedAt || Date.now();

  if (recordToStore && questions.length) {
    store.saveSession({
      id: session.id,
      mode: session.mode,
      title: session.title,
      chapterId: session.chapterId,
      difficulty: session.difficulty,
      total: result.total,
      correct,
      wrong,
      unanswered,
      pending,
      score,
      accuracy: result.accuracy,
      durationSec,
      userId: user ? user.id : null,
      detail,
    });
  }

  return result;
}

/**
 * 练习模式：单题即时反馈 + 错题本联动。
 * 简答题不自动判分，返回 null 表示“待自评”，也不会进错题本。
 */
export function applyInstantFeedback(question, userAnswer) {
  if (!isObjective(question.type)) return null;

  const ok = isCorrect(question, userAnswer);
  if (ok) {
    store.removeWrong(question.id);
  } else {
    store.addWrong(question, userAnswer);
  }
  return ok;
}

/** 交卷后批量更新错题本（跳过简答题） */
export function syncWrongBook(session, questions) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const item of (session.result ? session.result.detail : [])) {
    const q = byId.get(item.questionId);
    if (!q) continue;
    if (!isObjective(q.type)) continue;
    if (item.correct) store.removeWrong(q.id);
    else if (item.answered) store.addWrong(q, item.userAnswer);
  }
}

export { LETTERS, MAX_SCORE };
