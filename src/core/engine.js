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
 * 题型。
 *   single   单选
 *   multiple 多选，全对才得分
 *   fill     填空，按字符串匹配判分，支持多个可接受答案
 *   short    简答，无标准答案，不参与自动判分（只统计作答数）
 *   essay    论述，同简答处理（20 分大题，只看参考答案要点自评）
 *   judge    辨析题的「判断正误」步骤，选项是正确/错误，但要配合说明理由，算主观题
 */
export const TYPES = {
  single: { key: 'single', label: '单选题', objective: true },
  multiple: { key: 'multiple', label: '多选题', objective: true },
  fill: { key: 'fill', label: '填空题', objective: true },
  short: { key: 'short', label: '简答题', objective: false },
  essay: { key: 'essay', label: '论述题', objective: false },
  judge: { key: 'judge', label: '辨析题', objective: false },
};

/** 兼容历史数据：judge 归一化为 single（判分层面等价），但 isObjective 另行排除 */
export function normalizeType(type) {
  if (type === 'judge') return 'single';
  return TYPES[type] ? type : 'single';
}

/**
 * 是否属于"可自动判分、可进考卷"的题型。
 * 判断题（辨析题的判断正误步骤）虽然选项形式是 A/B，但要配合说明理由作答，
 * 属于主观题范畴，因此排除在组卷之外。
 */
export function isObjective(question) {
  const type = typeof question === 'string' ? question : question && question.type;
  if (type === 'judge') return false;
  return TYPES[normalizeType(type)].objective;
}

/** 是否为主观题（简答 / 论述 / 辨析理由）——这些只作为解析与得分点参考 */
export function isSubjective(question) {
  return !isObjective(question);
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
 * 填空题答案的宽松归一化：去掉所有空白、统一大小写、
 * 全角转半角、去掉常见中英文标点，避免“写法略有差异”被判错。
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

/** 填空题比较：命中任一可接受答案即算对 */
function sameFillAnswer(accepted, userText) {
  const mine = normalizeText(userText);
  if (!mine) return false;
  const list = Array.isArray(accepted) ? accepted : [accepted];
  return list.some((item) => normalizeText(item) === mine);
}

/**
 * 判断单题对错。
 * - 选项题：多选采用“全对才得分”
 * - 填空题：答案可写成数组，任意一项匹配即正确
 * - 简答题：无法自动判分，恒返回 false，由上层单独处理（见 gradeSession）
 */
export function isCorrect(question, userAnswer) {
  switch (normalizeType(question.type)) {
    case 'fill':
      return sameFillAnswer(question.answer, userAnswer);
    case 'short':
      return false;
    default:
      return sameChoiceAnswer(question.answer, userAnswer);
  }
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
    candidates = candidates.filter((q) => isObjective(q));
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
 * 考卷模块顺序：真卷里选择题的模块排列几乎固定。
 * 见用户提供的考情分析：1—10 马哲、11—16 毛泽东思想、17—20 邓小平理论等、
 * 21—30 习近平新时代、31—35 时事政治。
 */
export const PAPER_MODULES = [
  { key: '马哲', label: '马克思主义哲学', quota: 10, prefix: ['p1-'] },
  { key: '毛泽东思想', label: '毛泽东思想', quota: 6, prefix: ['p2-1', 'p2-2', 'p2-3', 'p2-4'] },
  { key: '邓小平理论等', label: '邓小平理论、"三个代表"、科学发展观', quota: 4, prefix: ['p2-5', 'p3-3', 'p3-4'] },
  { key: '习近平新时代', label: '习近平新时代中国特色社会主义思想', quota: 10, prefix: ['p3-5', 'p3-6', 'p3-7', 'p3-8', 'p2-6', 'p2-7', 'p2-8', 'p2-9', 'p2-10', 'p2-11'] },
  // 真卷第 31~35 题固定为时事政治
  { key: '时政', label: '时事政治', quota: 5, prefix: ['current'] },
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
 * 真卷配比（35 道）：马哲 10、毛泽东思想 6、邓小平理论等 4、习近平新时代 10、时政 5。
 * 某模块题量不足时，缺口由其他模块补齐，但**最终仍按模块顺序排列**，
 * 保证卷面结构与真卷一致（不会出现"做着做着又回到马哲"）。
 *
 * @param {Array} pool 已限定科目/章节/难度的题池
 * @param {number} count 总题量
 */
export function buildStructuredPaper(pool, count = 35) {
  const objective = pool.filter((q) => isObjective(q));

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
 * 依据：陕西成考专升本政治 150 分钟的题型配比反推——
 *   选择题（35 题）+ 简答（4 题）+ 论述（2 题）= 150 分钟
 *   选择 35×2 = 70 分钟，主观 4×10 + 2×18 = 76 分钟，合计约 146 分钟
 * 练习模式下每题还要读解析，所以取值偏宽松一点点。
 */
export const MINUTES_PER_TYPE = {
  single: 2, // 单选
  judge: 2.5, // 判断题含说明理由
  multiple: 3, // 多选
  fill: 2.5, // 填空
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
 * 填空题/简答题的答案是字符串，用原始值判断；选项题用字母数组判断。
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
  return normalizeType(question && question.type) === 'fill' || normalizeType(question && question.type) === 'short'
    ? ''
    : [];
}

/** 记录作答（多选题传新数组覆盖；填空题/简答题传字符串） */
export function setAnswer(session, questionId, answer, question = null) {
  const type = question ? normalizeType(question.type) : null;

  if (type === 'fill' || type === 'short') {
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
  if (type === 'fill' || type === 'short') {
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
 * 计分规则：满分 100，平均分给「参与自动判分的题」（选项题 + 填空题）。
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
    if (objective && answered) ok = isCorrect(q, type === 'fill' ? raw : normalizeAnswer(raw));

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
