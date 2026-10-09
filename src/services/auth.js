/**
 * 登录能力。
 *
 * 三种模式，运行时自动选择：
 *   1. local  —— 昵称/头像本地登录（默认，零依赖，随时可用）
 *   2. mock   —— “演示微信登录”，本地伪造 openid，用于走通流程
 *   3. wechat —— 真实微信网页授权：后端 /api/wechat/url 换 code -> /api/wechat/login 换用户信息
 *
 * 真实接入见 server/wechat-login-server.mjs 与 README「微信登录接入」。
 */

import * as store from '../core/store.js';
import { uid } from '../core/utils.js';

const API_BASE = (() => {
  // 允许通过 ?api=https://xxx 或全局变量覆盖后端地址
  const params = new URLSearchParams(window.location.search);
  return params.get('api') || window.__QUIZ_API_BASE__ || '';
})();

export const AVATAR_PRESETS = ['🙂', '🐱', '🐼', '🦊', '🐧', '🚀', '🌟', '🍀'];

export function currentUser() {
  return store.getUser();
}

export function isLoggedIn() {
  return store.isLoggedIn();
}

/** 本地登录 */
export function loginLocal({ nickname, avatar }) {
  if (!nickname || !nickname.trim()) throw new Error('请填写昵称');
  return store.signIn({
    id: uid('u'),
    nickname: nickname.trim().slice(0, 20),
    avatar: avatar || '',
    provider: 'local',
  });
}

export function logout() {
  return store.signOut();
}

/* ------------------------------------------------------------------ */
/* 后端可用性探测                                                      */
/* ------------------------------------------------------------------ */

let backendCache = null;

/** 探测后端是否可用（10 分钟缓存） */
export async function probeBackend() {
  if (!API_BASE) return false;
  if (backendCache && Date.now() - backendCache.at < 600000) return backendCache.ok;
  try {
    const res = await fetch(`${API_BASE}/api/health`, { method: 'GET' });
    const data = await res.json();
    backendCache = { ok: Boolean(data && data.ok), at: Date.now() };
  } catch (err) {
    backendCache = { ok: false, at: Date.now() };
  }
  return backendCache.ok;
}

/* ------------------------------------------------------------------ */
/* 微信登录                                                            */
/* ------------------------------------------------------------------ */

function readCookie(name) {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : '';
}

/**
 * 微信网页授权登录（真实后端）。
 * 流程：跳转后端 /api/wechat/url 获取授权地址 -> 微信回调后端 -> 后端带 token 回到本站
 */
export async function loginWithWechat({ redirect = null } = {}) {
  if (!API_BASE) throw new Error('NO_BACKEND');
  const target = redirect || window.location.href.split('#')[0];
  const res = await fetch(`${API_BASE}/api/wechat/url?redirect=${encodeURIComponent(target)}`);
  if (!res.ok) throw new Error('获取微信授权地址失败');
  const data = await res.json();
  if (!data.url) throw new Error('后端未返回授权地址');
  window.location.href = data.url;
}

/** 处理微信回调带回的一次性 ticket（页面加载时调用） */
export async function consumeWechatTicket() {
  const params = new URLSearchParams(window.location.search);
  const ticket = params.get('wx_ticket');
  if (!ticket) return null;
  if (!API_BASE) return null;
  const res = await fetch(`${API_BASE}/api/wechat/profile?ticket=${encodeURIComponent(ticket)}`);
  if (!res.ok) throw new Error('微信登录票据校验失败');
  const profile = await res.json();
  // 清掉地址栏里的 ticket，避免被分享/刷新重复使用
  params.delete('wx_ticket');
  const qs = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
  return store.signIn({
    id: profile.openid || uid('wx'),
    nickname: profile.nickname || '微信用户',
    avatar: profile.headimgurl || '',
    provider: 'wechat',
  });
}

/**
 * 演示用微信登录：不依赖任何后端，本地生成一个稳定的假 openid。
 * 用于在没有后端时演示“一键登录 -> 保存成绩 -> 我的页面”的完整链路。
 */
export function loginWithWechatDemo({ nickname = '微信用户', avatar = '' } = {}) {
  let openid = store.getSettings().__demoOpenid;
  if (!openid) {
    openid = `demo_openid_${uid('x')}`;
    store.saveSettings({ __demoOpenid: openid });
  }
  return store.signIn({
    id: openid,
    nickname,
    avatar,
    provider: 'wechat-demo',
  });
}

export function isDemoLogin() {
  return currentUser().provider === 'wechat-demo';
}

export { API_BASE, readCookie };
