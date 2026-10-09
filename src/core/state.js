/**
 * 全局状态：当前答题会话等跨页面数据。
 * 页面刷新后会话不保留（除非显式恢复），保证答题过程干净。
 */

import { on, emit } from './store.js';
import * as engine from './engine.js';

let currentSession = null;

export function getSession() {
  return currentSession;
}

export function requireSession() {
  if (!currentSession) throw new Error('NO_ACTIVE_SESSION');
  return currentSession;
}

export function startSession(config) {
  currentSession = engine.createSession(config);
  emit('session:start', currentSession);
  return currentSession;
}

export function updateSession(patch) {
  if (!currentSession) return null;
  Object.assign(currentSession, patch);
  emit('session:update', currentSession);
  return currentSession;
}

export function endSession() {
  const session = currentSession;
  currentSession = null;
  emit('session:end', session);
  return session;
}

export { on, emit };
