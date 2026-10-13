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

/* ------------------------------------------------------------------ */
/* 触摸手势                                                            */
/* ------------------------------------------------------------------ */

/**
 * 给元素挂左右滑动切题手势（触摸 + 鼠标拖拽都支持，方便桌面调试）。
 *
 * 判定规则：
 *   - 水平位移超过 threshold 像素
 *   - 且水平位移明显大于垂直位移（避免与上下滚动打架）
 *   - 单次触摸只触发一次
 *
 * @param {HTMLElement} el
 * @param {object} handlers { onLeft, onRight, onStart, onEnd }
 *   onLeft  —— 手指由右向左滑（看下一题）
 *   onRight —— 手指由左向右滑（看上一题）
 * @param {object} opts { threshold = 50, dominance = 1.4, mouse = false }
 * @returns {Function} 解绑函数
 */
export function bindSwipe(el, handlers = {}, opts = {}) {
  if (!el) return () => {};
  const threshold = opts.threshold == null ? 50 : opts.threshold;
  const dominance = opts.dominance == null ? 1.4 : opts.dominance;
  // 默认只绑触摸：桌面浏览器上鼠标拖拽多为选中文字，容易误触发
  const useMouse = opts.mouse === true;

  let startX = 0;
  let startY = 0;
  let tracking = false;
  let fired = false;

  const begin = (x, y) => {
    startX = x;
    startY = y;
    tracking = true;
    fired = false;
    if (handlers.onStart) handlers.onStart();
  };

  const finish = () => {
    tracking = false;
    if (handlers.onEnd) handlers.onEnd();
  };

  const move = (x, y, evt) => {
    if (!tracking || fired) return;
    const dx = x - startX;
    const dy = y - startY;
    if (Math.abs(dx) < threshold) return;
    // 垂直位移过大说明用户是在上下滚动，放弃本次手势
    if (Math.abs(dy) * dominance > Math.abs(dx)) return;

    fired = true;
    if (dx < 0) {
      if (handlers.onLeft) handlers.onLeft();
    } else if (handlers.onRight) {
      handlers.onRight();
    }
    // 触发后允许浏览器继续处理该次触摸（不 preventDefault，保留下拉刷新等行为）
    if (evt && evt.cancelable) { /* 有意不拦截 */ }
  };

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) return; // 多指（缩放）不参与
    begin(e.touches[0].clientX, e.touches[0].clientY);
  };
  const onTouchMove = (e) => {
    if (e.touches.length !== 1) return;
    move(e.touches[0].clientX, e.touches[0].clientY, e);
  };
  const onTouchEnd = () => finish();

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    begin(e.clientX, e.clientY);
  };
  const onMouseMove = (e) => {
    if (!tracking) return;
    move(e.clientX, e.clientY, e);
  };
  const onMouseUp = () => { if (tracking) finish(); };

  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: true });
  el.addEventListener('touchend', onTouchEnd, { passive: true });
  el.addEventListener('touchcancel', onTouchEnd, { passive: true });
  if (useMouse) {
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('mousemove', onMouseMove);
    el.addEventListener('mouseup', onMouseUp);
    el.addEventListener('mouseleave', onMouseUp);
  }

  return () => {
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
    el.removeEventListener('touchcancel', onTouchEnd);
    if (useMouse) {
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('mouseleave', onMouseUp);
    }
  };
}
