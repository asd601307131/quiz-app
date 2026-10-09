/**
 * 通用工具函数：无依赖，浏览器与 Node 均可载入（Node 下需 ESM）。
 */

/** 生成短 id（无需加密强度，仅用于本地会话/记录标识） */
export function uid(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** 安全转义，用于把用户/题库文本插入 innerHTML */
export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 题库文本内的换行转 <br>（转义后调用） */
export function nl2br(escaped) {
  return escaped.replace(/\n/g, '<br>');
}

/** 秒 -> mm:ss */
export function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** 秒 -> “1 分 20 秒”，用于成绩展示 */
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} 分 ${r} 秒` : `${m} 分`;
}

/** 时间戳 -> 2025-01-02 15:04 */
export function fmtTime(ts) {
  if (!ts) return '--';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 洗牌（返回新数组，Fisher-Yates） */
export function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 按 key 计数分组 */
export function countBy(list, keyFn) {
  const out = {};
  for (const item of list) {
    const k = keyFn(item);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/** 求百分比（0-100 整数） */
export function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

/** 深拷贝纯数据（题库/ls 数据均为 JSON 安全结构） */
export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
