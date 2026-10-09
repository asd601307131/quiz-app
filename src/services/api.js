/**
 * 数据访问层。
 *
 * 设计意图：页面只调用 api.xxx()，不关心数据来自本地还是后端。
 * 默认走本地题库 + localStorage，保证「零后端即可跑通」；
 * 传入 ?api=https://your-host 后自动切换为远端接口（字段与本地结构一致）。
 *
 * 远端接口约定：
 *   GET  /api/chapters                 -> Chapter[]
 *   GET  /api/questions?chapterId=&difficulty= -> Question[]
 *   POST /api/sessions                 -> 保存成绩 { ...record }
 *   GET  /api/sessions?userId=         -> Session[]
 *   POST /api/wrong                    -> 上报错题 { questionId, wrongCount }
 *   GET  /api/health                   -> { ok: true }
 */

import * as store from '../core/store.js';
import { CHAPTERS, QUESTIONS, chapterStats } from '../data/questions.js';
import { API_BASE } from './auth.js';

const REMOTE = Boolean(API_BASE);
const LOCAL_CHAPTERS = CHAPTERS;

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`接口 ${path} 失败：${res.status}`);
  return res.json();
}

export const api = {
  /** 数据来源标识，页面可据此提示用户 */
  get source() {
    return REMOTE ? 'remote' : 'local';
  },

  async getChapters() {
    if (REMOTE) {
      try {
        return await request('/api/chapters');
      } catch (err) {
        console.warn('[api] 远端章节失败，回退本地', err);
      }
    }
    return LOCAL_CHAPTERS.map((c) => ({ ...c, stats: chapterStats(c.id) }));
  },

  async getQuestions({ chapterId = null, difficulty = null } = {}) {
    if (REMOTE) {
      try {
        const qs = new URLSearchParams();
        if (chapterId) qs.set('chapterId', chapterId);
        if (difficulty) qs.set('difficulty', difficulty);
        return await request(`/api/questions?${qs.toString()}`);
      } catch (err) {
        console.warn('[api] 远端题库失败，回退本地', err);
      }
    }
    return QUESTIONS.filter(
      (q) => (!chapterId || q.chapterId === chapterId) && (!difficulty || q.difficulty === difficulty)
    );
  },

  /* ---- 成绩记录：本地优先，远端异步补写 ---- */

  getSessions() {
    return store.getSessions();
  },

  async saveSession(record) {
    const local = store.saveSession(record);
    if (REMOTE) {
      request('/api/sessions', { method: 'POST', body: JSON.stringify(record) }).catch((err) =>
        console.warn('[api] 成绩上报失败', err)
      );
    }
    return local;
  },

  /* ---- 错题本 ---- */

  getWrongBook() {
    return store.getWrongBook();
  },

  async reportWrong(questionId, wrongCount) {
    if (REMOTE) {
      request('/api/wrong', {
        method: 'POST',
        body: JSON.stringify({ questionId, wrongCount }),
      }).catch((err) => console.warn('[api] 错题上报失败', err));
    }
  },

  async health() {
    if (!REMOTE) return { ok: true, storage: 'local' };
    try {
      return await request('/api/health');
    } catch (err) {
      return { ok: false };
    }
  },
};

export default api;
