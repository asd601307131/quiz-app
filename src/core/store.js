/**
 * 本地存储层 + 轻量事件总线。
 * 数据结构全部 JSON 安全，便于后续迁移到云端（字段名与后端表结构保持一致）。
 */

import { uid } from './utils.js';

const NS = 'quizapp.v1';
const KEYS = {
  user: `${NS}.user`,
  sessions: `${NS}.sessions`, // 答题记录（成绩历史）
  wrong: `${NS}.wrong`, // 错题本：questionId -> 记录
  stats: `${NS}.stats`, // 累计统计
  settings: `${NS}.settings`,
};

/* ------------------------------------------------------------------ */
/* 底层读写                                                            */
/* ------------------------------------------------------------------ */

function available() {
  try {
    const k = '__probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch (err) {
    return false;
  }
}

const memory = new Map(); // localStorage 不可用时的降级（隐私模式等）
const canUseLS = typeof window !== 'undefined' && available();

function readRaw(key, fallback) {
  try {
    const raw = canUseLS ? window.localStorage.getItem(key) : memory.get(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function writeRaw(key, value) {
  const raw = JSON.stringify(value);
  if (canUseLS) {
    window.localStorage.setItem(key, raw);
  } else {
    memory.set(key, raw);
  }
  emit('change', { key });
}

/* ------------------------------------------------------------------ */
/* 事件总线（模块间解耦，页面订阅后自动刷新）                            */
/* ------------------------------------------------------------------ */

const listeners = new Map();

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event).delete(handler);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const handler of set) {
    try {
      handler(payload);
    } catch (err) {
      console.error('[store] listener error', err);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 用户                                                                */
/* ------------------------------------------------------------------ */

const GUEST = {
  id: 'guest',
  nickname: '未登录用户',
  avatar: '',
  provider: 'guest',
  createdAt: 0,
};

export function getUser() {
  const user = readRaw(KEYS.user, null);
  return user || { ...GUEST };
}

export function isLoggedIn() {
  const user = readRaw(KEYS.user, null);
  return Boolean(user && user.provider && user.provider !== 'guest');
}

export function saveUser(patch) {
  const next = { ...getUser(), ...patch, updatedAt: Date.now() };
  writeRaw(KEYS.user, next);
  emit('user', next);
  return next;
}

export function signIn({ id, nickname, avatar = '', provider = 'local' }) {
  return saveUser({
    id: id || uid('u'),
    nickname: nickname || '答题小能手',
    avatar,
    provider,
    createdAt: getUser().createdAt || Date.now(),
  });
}

export function signOut() {
  writeRaw(KEYS.user, { ...GUEST });
  emit('user', { ...GUEST });
  return { ...GUEST };
}

/* ------------------------------------------------------------------ */
/* 答题记录（成绩历史）                                                 */
/* ------------------------------------------------------------------ */

export function getSessions() {
  return readRaw(KEYS.sessions, []);
}

export function getSession(sessionId) {
  return getSessions().find((s) => s.id === sessionId) || null;
}

/**
 * 保存一次答题记录。
 * @param {object} record { mode, title, chapterId, difficulty, total, correct, wrong, unanswered, score, accuracy, durationSec, detail: [...] }
 */
export function saveSession(record) {
  const sessions = getSessions();
  const entry = {
    id: record.id || uid('s'),
    createdAt: Date.now(),
    ...record,
  };
  sessions.unshift(entry);
  writeRaw(KEYS.sessions, sessions.slice(0, 200)); // 本地只留最近 200 条
  bumpStats(entry);
  emit('sessions', sessions);
  return entry;
}

export function clearSessions() {
  writeRaw(KEYS.sessions, []);
  emit('sessions', []);
}

/* ------------------------------------------------------------------ */
/* 错题本                                                              */
/* ------------------------------------------------------------------ */

export function getWrongBook() {
  const book = readRaw(KEYS.wrong, {});
  return Object.values(book).sort((a, b) => (b.lastWrongAt || 0) - (a.lastWrongAt || 0));
}

export function isWrong(questionId) {
  const book = readRaw(KEYS.wrong, {});
  return Boolean(book[questionId]);
}

/** 记录一道错题（重复答错累加次数） */
export function addWrong(question, answer) {
  const book = readRaw(KEYS.wrong, {});
  const prev = book[question.id];
  book[question.id] = {
    questionId: question.id,
    chapterId: question.chapterId,
    difficulty: question.difficulty,
    wrongCount: (prev ? prev.wrongCount : 0) + 1,
    lastAnswer: answer,
    lastWrongAt: Date.now(),
    firstWrongAt: prev ? prev.firstWrongAt : Date.now(),
  };
  writeRaw(KEYS.wrong, book);
  emit('wrong', book);
  return book[question.id];
}

/** 从错题本移除（例如复习时答对了） */
export function removeWrong(questionId) {
  const book = readRaw(KEYS.wrong, {});
  if (book[questionId]) {
    delete book[questionId];
    writeRaw(KEYS.wrong, book);
    emit('wrong', book);
  }
}

export function clearWrongBook() {
  writeRaw(KEYS.wrong, {});
  emit('wrong', {});
}

/* ------------------------------------------------------------------ */
/* 累计统计                                                            */
/* ------------------------------------------------------------------ */

const EMPTY_STATS = {
  answered: 0,
  correct: 0,
  exams: 0,
  practice: 0,
  streakDays: 0,
  lastActiveDay: '',
  bestScore: 0,
  totalDurationSec: 0,
};

export function getStats() {
  return { ...EMPTY_STATS, ...readRaw(KEYS.stats, {}) };
}

function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayDiff(a, b) {
  const pa = new Date(`${a}T00:00:00`);
  const pb = new Date(`${b}T00:00:00`);
  return Math.round((pb - pa) / 86400000);
}

function bumpStats(entry) {
  const stats = getStats();
  stats.answered += entry.total || 0;
  stats.correct += entry.correct || 0;
  stats.totalDurationSec += entry.durationSec || 0;
  if (entry.mode === 'exam') {
    stats.exams += 1;
    stats.bestScore = Math.max(stats.bestScore || 0, entry.score || 0);
  } else {
    stats.practice += 1;
  }

  const today = todayKey();
  if (stats.lastActiveDay !== today) {
    if (stats.lastActiveDay && dayDiff(stats.lastActiveDay, today) === 1) {
      stats.streakDays = (stats.streakDays || 0) + 1;
    } else {
      stats.streakDays = 1;
    }
    stats.lastActiveDay = today;
  }
  writeRaw(KEYS.stats, stats);
  emit('stats', stats);
}

export function resetAll() {
  [KEYS.user, KEYS.sessions, KEYS.wrong, KEYS.stats, KEYS.settings].forEach((k) => {
    if (canUseLS) window.localStorage.removeItem(k);
    memory.delete(k);
  });
  emit('change', { key: 'all' });
  emit('user', getUser());
  emit('sessions', []);
  emit('wrong', {});
  emit('stats', getStats());
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = {
  shuffleOptions: false, // 考试模式是否打乱选项
  autoNext: true, // 单选作答后自动跳下一题（练习模式）
  examQuestionCount: 10,
  examDurationMin: 10,
};

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readRaw(KEYS.settings, {}) };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeRaw(KEYS.settings, next);
  emit('settings', next);
  return next;
}

export const STORAGE_KEYS = KEYS;
