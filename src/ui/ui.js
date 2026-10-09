/**
 * 轻量 UI 基元：DOM 构建、顶部栏、标签栏、确认弹窗、Toast。
 * 所有文本插入统一走 esc()，避免 XSS。
 */

import { esc } from '../core/utils.js';

/* ------------------------------------------------------------------ */
/* DOM 构建                                                            */
/* ------------------------------------------------------------------ */

/**
 * h('div.card', { onclick }, [child, 'text'])
 * 标签语法支持 "tag.class1.class2#id"。
 */
export function h(selector, props = null, children = null) {
  const m = /^([a-zA-Z0-9-]*)((?:[.#][\w-]+)*)$/.exec(selector);
  if (!m) throw new Error(`非法选择器: ${selector}`);
  const tag = m[1] || 'div';
  const el = document.createElement(tag);
  const suffix = m[2] || '';

  for (const token of suffix.match(/[.#][\w-]+/g) || []) {
    if (token[0] === '.') el.classList.add(token.slice(1));
    else el.id = token.slice(1);
  }

  applyProps(el, props);
  appendChildren(el, children);
  return el;
}

/** 属性/事件绑定：onXxx 走事件，其余走属性或 property */
export function applyProps(el, props) {
  if (!props) return el;
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') {
      el.innerHTML = value;
    } else if (key === 'text') {
      el.textContent = value;
    } else if (key === 'class') {
      String(value)
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => el.classList.add(c));
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(el.dataset, value);
    } else if (key in el) {
      el[key] = value;
    } else {
      el.setAttribute(key, value);
    }
  }
  return el;
}

export function appendChildren(el, children) {
  if (children == null) return el;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
  return el;
}

/** 直接生成 HTML 字符串（用于需要 innerHTML 的模板片段） */
export function html(strings, ...values) {
  return strings.reduce((acc, str, i) => acc + str + (values[i] == null ? '' : esc(values[i])), '');
}

/* ------------------------------------------------------------------ */
/* 顶部栏                                                              */
/* ------------------------------------------------------------------ */

/**
 * @param {object} opts { title, onBack, extra: Node|string, sticky }
 */
export function header({ title = '', onBack = null, extra = null } = {}) {
  const left = onBack
    ? h('button.header__back', { type: 'button', 'aria-label': '返回', onclick: onBack, text: '‹' })
    : null;
  const right = extra
    ? extra instanceof Node
      ? extra
      : h('div.header__extra', null, [extra])
    : null;
  return h('header.header', null, [left, h('h1.header__title', { text: title }), right || h('div.header__extra')]);
}

/* ------------------------------------------------------------------ */
/* 底部标签栏                                                          */
/* ------------------------------------------------------------------ */

export const TABS = [
  { route: 'home', label: '首页', icon: '🏠' },
  { route: 'wrong', label: '错题本', icon: '📕' },
  { route: 'history', label: '记录', icon: '📊' },
  { route: 'profile', label: '我的', icon: '👤' },
];

export function tabbar(active) {
  return h(
    'nav.tabbar',
    null,
    TABS.map((tab) =>
      h(
        'a.tabbar__item' + (tab.route === active ? '.tabbar__item--active' : ''),
        { href: `#/${tab.route}` },
        [h('span.tabbar__icon', { text: tab.icon }), h('span', { text: tab.label })]
      )
    )
  );
}

/* ------------------------------------------------------------------ */
/* 常用片段                                                            */
/* ------------------------------------------------------------------ */

export function tagList(items) {
  return h('div.tag-row', null, items.filter(Boolean));
}

export function tag(text, modifier = '') {
  return h(`span.tag${modifier ? `.tag--${modifier}` : ''}`, { text });
}

export function progressBar(value, modifier = '') {
  return h('div.progress', null, [
    h(`div.progress__bar${modifier ? `.progress__bar--${modifier}` : ''}`, {
      style: { width: `${Math.min(100, Math.max(0, value))}%` },
    }),
  ]);
}

export function emptyState(icon, text) {
  return h('div.empty', null, [
    h('div.empty__icon', { text: icon }),
    h('div.empty__text', { text }),
  ]);
}

/* ------------------------------------------------------------------ */
/* Toast                                                              */
/* ------------------------------------------------------------------ */

export function toast(message, duration = 1800) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = h('div.toast', { text: message });
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, duration);
}

/* ------------------------------------------------------------------ */
/* 确认弹窗                                                            */
/* ------------------------------------------------------------------ */

/**
 * @returns {Promise<boolean>} 用户是否点了确定
 */
export function confirmDialog({ title = '提示', text = '', okText = '确定', cancelText = '取消' } = {}) {
  return new Promise((resolve) => {
    const mask = h('div.mask', null, [
      h('div.dialog', { role: 'dialog', 'aria-modal': 'true' }, [
        h('h3.dialog__title', { text: title }),
        text ? h('p.dialog__text', { text }) : null,
        h('div.dialog__actions', null, [
          h('button.btn.btn--ghost', {
            type: 'button',
            text: cancelText,
            onclick: () => close(false),
          }),
          h('button.btn.btn--primary', {
            type: 'button',
            text: okText,
            onclick: () => close(true),
          }),
        ]),
      ]),
    ]);

    function close(result) {
      mask.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }

    function onKey(e) {
      if (e.key === 'Escape') close(false);
    }

    mask.addEventListener('click', (e) => {
      if (e.target === mask) close(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(mask);
  });
}

/* ------------------------------------------------------------------ */
/* 头像                                                                */
/* ------------------------------------------------------------------ */

export function avatarNode(user, fallback = '🙂') {
  const node = h('div.avatar');
  if (user && user.avatar) {
    node.appendChild(h('img', { src: user.avatar, alt: user.nickname || '头像' }));
  } else {
    node.textContent = fallback;
  }
  return node;
}
