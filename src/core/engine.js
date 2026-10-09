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

const MAX_SCORE = 100;

/* ------------------------------------------------------------------ */
/* 判分                                                                */
/* ------------------------------------------------------------------ */

/**
 * 答案统一为“升序去重”的字母数组，题型无关，便于比较。
 * 只接受字符串（或含 key 的对象被上层转换后的字符串），null/undefined 一律剔除。
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

function sameAnswer(a, b) {
  const x = normalizeAnswer(a);
  const y = normalizeAnswer(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * 判断单题对错。
 * 多选采用“全对才得分”策略（可在 grading 中改为按项给分）。
 */
export function isCorrect(question, userAnswer) {
  return sameAnswer(question.answer, userAnswer);
}

/* ------------------------------------------------------------------ */
/* 组卷                                                                */
/* ------------------------------------------------------------------ */

/**
 * 随机抽题组卷。
 * @param {Array} pool 题库
 * @param {object} opts { count, chapterIds, difficulties }
 */
export function buildPaper(pool, opts = {}) {
  const { count = 10, chapterIds = null, difficulties = null, seedQuestions = null } = opts;
  let candidates = pool.slice();

  if (seedQuestions && seedQuestions.length) {
    // 错题重练：按给定题目顺序出卷
    const byId = new Map(pool.map((q) => [q.id, q]));
    candidates = seedQuestions.map((s) => byId.get(typeof s === 'string' ? s : s.questionId)).filter(Boolean);
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
    submitted: false,
    result: null,
  };
}

/** 会话中已作答题数 */
export function answeredCount(session) {
  return Object.values(session.answers).filter((a) => normalizeAnswer(a).length > 0).length;
}

export function isAnswered(session, questionId) {
  return normalizeAnswer(session.answers[questionId]).length > 0;
}

/** 记录作答（多选会覆盖） */
export function setAnswer(session, questionId, answer) {
  const list = normalizeAnswer(answer);
  if (!list.length) {
    delete session.answers[questionId];
  } else {
    session.answers[questionId] = list;
  }
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

/* ------------------------------------------------------------------ */
/* 交卷判分                                                            */
/* ------------------------------------------------------------------ */

/**
 * 交卷。返回结果对象并写入会话。
 * 计分：每题等分（满分 100，四舍五入保留 1 位）。
 */
export function gradeSession(session, { recordToStore = true, user = null } = {}) {
  const questions = session.questions;
  const perScore = questions.length ? MAX_SCORE / questions.length : 0;
  const detail = [];
  let correct = 0;
  let wrong = 0;
  let unanswered = 0;

  for (const q of questions) {
    const userAnswer = normalizeAnswer(session.answers[q.id]);
    const ok = userAnswer.length > 0 && isCorrect(q, userAnswer);
    if (userAnswer.length === 0) unanswered += 1;
    else if (ok) correct += 1;
    else wrong += 1;

    detail.push({
      questionId: q.id,
      chapterId: q.chapterId,
      difficulty: q.difficulty,
      type: q.type,
      userAnswer,
      rightAnswer: normalizeAnswer(q.answer),
      correct: ok,
      answered: userAnswer.length > 0,
    });
  }

  const score = Math.round(correct * perScore * 10) / 10;
  const durationSec = Math.max(0, Math.round(((session.submittedAt || Date.now()) - session.startedAt) / 1000));
  const result = {
    sessionId: session.id,
    mode: session.mode,
    total: questions.length,
    correct,
    wrong,
    unanswered,
    score,
    accuracy: percent(correct, questions.length),
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
      score,
      accuracy: result.accuracy,
      durationSec,
      userId: user ? user.id : null,
      detail,
    });
  }

  return result;
}

/** 练习模式：单题即时反馈 + 错题本联动 */
export function applyInstantFeedback(question, userAnswer) {
  const ok = isCorrect(question, userAnswer);
  if (ok) {
    store.removeWrong(question.id);
  } else {
    store.addWrong(question, normalizeAnswer(userAnswer));
  }
  return ok;
}

/** 交卷后批量更新错题本 */
export function syncWrongBook(session, questions) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const item of (session.result ? session.result.detail : [])) {
    const q = byId.get(item.questionId);
    if (!q) continue;
    if (item.correct) store.removeWrong(q.id);
    else if (item.answered) store.addWrong(q, item.userAnswer);
  }
}

export { LETTERS, MAX_SCORE };
