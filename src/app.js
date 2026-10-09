/**
 * 应用入口：hash 路由 + 视图挂载 + 全局错误兜底。
 *
 * 路由表：
 *   #/home
 *   #/subjects | #/subject/:id           两大板块（政治 / 英语）与科目详情
 *   #/strategy | #/strategy/:id          答题技巧板块（内容讲解）
 *   #/chapters | #/chapter/:id           章节列表（兼容入口）与章节详情
 *   #/setup/practice | #/setup/exam
 *   #/quiz/chapter/:id | #/quiz/random | #/quiz/exam | #/quiz/wrong
 *   #/sheet | #/result/:id | #/review/:questionId
 *   #/wrong | #/history | #/profile | #/login
 */

import { h, header, toast, emptyState } from './ui/ui.js';
import * as store from './core/store.js';
import * as auth from './services/auth.js';
import {
  HomeView,
  ChaptersView,
  ChapterView,
  SetupView,
  WrongView,
  HistoryView,
  ProfileView,
  NotFoundView,
} from './views/home.js';
import { QuizView, SheetView, ResultView, ReviewView, __resetQuiz } from './views/quiz.js';
import { LoginView } from './views/login.js';
import { SubjectsView, SubjectView, StrategyView, StrategyTopicView } from './views/catalog.js';

const TITLES = {
  home: '答题闯关',
  subjects: '题库板块',
  subject: '板块',
  strategy: '答题技巧',
  chapters: '章节练习',
  setup: '组卷',
  quiz: '答题中',
  sheet: '答题卡',
  result: '答题结果',
  review: '错题回顾',
  wrong: '错题本',
  history: '答题记录',
  profile: '我的',
  login: '登录',
};

let mountedRoute = null;

/**
 * 解析 location.hash -> { route, base, segments, query }
 *
 * 约定：route 始终等于第一段（如 'chapter'、'quiz'、'result'），
 *      其余段落放进 segments 作为参数，避免出现 'chapter/js' 这类拼接值。
 *   例：#/chapter/js      -> route='chapter', segments=['chapter','js']
 *       #/quiz/chapter/js -> route='quiz',    segments=['quiz','chapter','js']
 */
export function parseHash(hash = window.location.hash) {
  const raw = (hash || '').replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = {};
  if (queryPart) {
    for (const [k, v] of new URLSearchParams(queryPart).entries()) query[k] = v;
  }
  const route = segments.length ? segments[0] : 'home';
  return { route, base: route, segments, query };
}

/** 编程式导航 */
export function go(path) {
  const target = `#/${String(path).replace(/^#?\/?/, '')}`;
  if (window.location.hash === target) {
    render();
  } else {
    window.location.hash = target;
  }
}

export function back() {
  if (window.history.length > 1) window.history.back();
  else go('home');
}

/* ------------------------------------------------------------------ */
/* 视图选择                                                            */
/* ------------------------------------------------------------------ */

/**
 * 视图分派。
 * 注意：parseHash 会把 `#/chapter/js` 解析为 route='chapter/js'、base='chapter'，
 * 因此这里统一按 base 分派，segments 提供参数。
 */
function resolveView({ route, base, segments, query }) {
  switch (base) {
    case 'home':
      return HomeView();
    case 'subjects':
      return SubjectsView();
    case 'subject':
      return SubjectView({ id: segments[1] });
    case 'strategy':
      return segments[1] ? StrategyTopicView({ id: segments[1] }) : StrategyView();
    case 'chapters':
      return ChaptersView();
    case 'chapter':
      return ChapterView({ id: segments[1] });
    case 'setup':
      return SetupView({ mode: segments[1] === 'exam' ? 'exam' : 'practice' });
    case 'quiz': {
      const kind = segments[1];
      if (!['chapter', 'random', 'exam', 'wrong'].includes(kind)) return NotFoundView();
      // 传完整子路由（quiz/chapter 等），供答题视图选择取题策略
      return QuizView({ route: `quiz/${kind}`, query: { ...query, id: segments[2] || query.id } });
    }
    case 'sheet':
      return SheetView();
    case 'result':
      return ResultView({ id: segments[1] });
    case 'review':
      return ReviewView({ id: segments[1] });
    case 'wrong':
      return WrongView();
    case 'history':
      return HistoryView();
    case 'profile':
      return ProfileView();
    case 'login':
      return LoginView();
    default:
      return NotFoundView();
  }
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

function ErrorView(err) {
  return h('div.page', null, [
    header({ title: '出错了', onBack: () => go('home') }),
    h('div.page__body', null, [
      emptyState('⚠️', '页面渲染失败'),
      h('pre.text-sm', {
        style: {
          whiteSpace: 'pre-wrap',
          background: '#fff',
          padding: '12px',
          borderRadius: '12px',
          color: '#e5484d',
          overflowX: 'auto',
        },
        text: String((err && err.stack) || err),
      }),
      h('div.mt-16', null, [
        h('button.btn.btn--primary.btn--block', {
          type: 'button',
          text: '回到首页',
          onclick: () => go('home'),
        }),
      ]),
    ]),
  ]);
}

function render() {
  const rawHash = window.location.hash;
  const parsed = parseHash(rawHash);
  const root = document.getElementById('app');

  // 回到首页视为离开答题流程，销毁会话与计时器（避免浏览器后退恢复旧答卷）
  if (parsed.route === 'home') {
    __resetQuiz();
  }

  let node;
  try {
    node = resolveView(parsed);
  } catch (err) {
    console.error('[app] render failed', err);
    node = ErrorView(err);
  }

  root.replaceChildren(node);
  mountedRoute = parsed.route;

  const base = TITLES[parsed.base] || '答题闯关';
  document.title = parsed.route === 'home' ? '答题闯关 · 移动端答题应用' : `${base} · 答题闯关`;
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  // 微信回调：地址栏带 wx_ticket 时先换取用户信息
  try {
    const user = await auth.consumeWechatTicket();
    if (user) toast(`欢迎，${user.nickname}`);
  } catch (err) {
    console.warn('[app] 微信登录回调处理失败', err);
    toast('微信登录失败，请重试');
  }

  if (!window.location.hash) {
    window.location.hash = '#/home';
  }
  render();
}

window.addEventListener('hashchange', render);
window.addEventListener('error', (e) => console.error('[app] window error', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[app] unhandled rejection', e.reason));

boot();

/* 导出给调试面板使用 */
window.__QUIZ__ = {
  store,
  auth,
  go,
  parseHash,
  render,
  resolveView,
  debug(hash = window.location.hash) {
    const parsed = parseHash(hash);
    const node = resolveView(parsed);
    return {
      parsed,
      outer: node.outerHTML.slice(0, 240),
      title: (node.querySelector && node.querySelector('.header__title') || {}).innerText || null,
    };
  },
};
