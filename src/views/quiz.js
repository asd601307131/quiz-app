/**
 * 答题页 / 答题卡 / 结果与解析
 *
 * 三种进入方式：
 *   quiz/chapter/<id>          章节顺序练习（即时反馈、可看解析、自动下一题）
 *   quiz/random?c=&d=&n=       随机组卷练习
 *   quiz/exam?c=&d=&n=&t=      限时模拟考试（交卷后统一判分）
 *   quiz/wrong?ids=            错题复习（答对自动移出错题本）
 *   review/<questionId>        错题本单题回顾
 */

import { h, header, toast, confirmDialog, tag, emptyState } from '../ui/ui.js';
import * as store from '../core/store.js';
import * as state from '../core/state.js';
import * as engine from '../core/engine.js';
import { QUESTIONS, getQuestion, getChapter } from '../data/questions.js';
import { fmtClock, fmtDuration, fmtTime, percent, shuffle } from '../core/utils.js';
import { go, back } from '../app.js';

/* ------------------------------------------------------------------ */
/* 会话状态                                                            */
/* ------------------------------------------------------------------ */

/** 当前答题控制器（含计时器），离开页面时必须销毁 */
let active = null;

function destroyActive() {
  if (active && active.cleanup) {
    try {
      active.cleanup();
    } catch (err) {
      console.error('[quiz] cleanup failed', err);
    }
  }
  active = null;
}

export function __resetQuiz() {
  destroyActive();
  state.endSession();
}

/** 单选/判断题的展示顺序（考试模式下可打乱）；填空/简答题没有选项，返回空数组 */
function makeOptionOrder(question, shuffleOptions) {
  if (!Array.isArray(question.options) || !question.options.length) return [];
  const letters = question.options.map((_, i) => engine.LETTERS[i]);
  return shuffleOptions && question.type === 'single' ? shuffle(letters) : letters;
}

function buildQuestions(route, query) {
  const parseList = (v) => (v ? v.split(',').filter(Boolean) : null);

  if (route === 'quiz/chapter') {
    const chapterId = query.id;
    return {
      list: QUESTIONS.filter((q) => q.chapterId === chapterId),
      mode: 'practice',
      title: `${getChapter(chapterId) ? getChapter(chapterId).name : '章节'}练习`,
      chapterId,
    };
  }

  if (route === 'quiz/random') {
    const chapterIds = parseList(query.c);
    const difficulties = parseList(query.d);
    const list = engine.buildPaper(QUESTIONS, {
      count: Number(query.n) || 10,
      chapterIds,
      difficulties,
    });
    return { list, mode: 'practice', title: '随机组卷练习', chapterIds, difficulties };
  }

  if (route === 'quiz/exam') {
    const chapterIds = parseList(query.c);
    const difficulties = parseList(query.d);
    const list = engine.buildPaper(QUESTIONS, {
      count: Number(query.n) || 10,
      chapterIds,
      difficulties,
    });
    return {
      list,
      mode: 'exam',
      title: '模拟考试',
      chapterIds,
      difficulties,
      durationSec: (Number(query.t) || 10) * 60,
    };
  }

  if (route === 'quiz/wrong') {
    const ids = parseList(query.ids) || [];
    const list = engine.buildPaper(QUESTIONS, { seedQuestions: ids });
    return { list, mode: 'practice', title: '错题复习' };
  }

  return { list: [], mode: 'practice', title: '练习' };
}

/* ------------------------------------------------------------------ */
/* 答题页                                                              */
/* ------------------------------------------------------------------ */

export function QuizView({ route, query }) {
  // 进入新的答题流程：销毁上一次会话
  if (!active || active.route !== route || active.token !== query.token) {
    destroyActive();
    const built = buildQuestions(route, query);
    if (!built.list.length) {
      toast('没有可用题目');
      go('home');
      return h('div.page', null, [header({ title: '提示', onBack: () => go('home') })]);
    }

    const session = state.startSession({
      mode: built.mode,
      title: built.title,
      chapterId: built.chapterId || null,
      chapterIds: built.chapterIds || null,
      difficulties: built.difficulties || null,
      questions: built.list,
      durationSec: built.durationSec || 0,
    });

    const settings = store.getSettings();
    session.optionOrder = {};
    session.flags = {};
    session.revealed = {}; // 练习模式：已揭晓解析的题目
    session.feedback = {}; // 练习模式：题目 -> 是否正确
    built.list.forEach((q) => {
      session.optionOrder[q.id] = makeOptionOrder(
        q,
        built.mode === 'exam' ? settings.shuffleOptions : false
      );
    });

    active = {
      route,
      token: query.token || String(Date.now()),
      session,
      timer: null,
      cleanup: null,
    };

    if (session.durationSec > 0) {
      active.timer = setInterval(() => {
        const s = state.getSession();
        if (!s || s.submitted) return;
        s.remainingSec = Math.max(0, s.remainingSec - 1);
        const timerEl = document.querySelector('[data-role="timer"]');
        if (timerEl) {
          timerEl.textContent = fmtClock(s.remainingSec);
          timerEl.classList.toggle('quiz-meta__timer--warn', s.remainingSec <= 60);
        }
        if (s.remainingSec <= 0) {
          toast('考试时间到，自动交卷');
          submit(true);
        }
      }, 1000);
    }

    active.cleanup = () => {
      if (active && active.timer) clearInterval(active.timer);
    };
  }

  return renderQuiz();
}

function currentSession() {
  return state.requireSession();
}

function submit(auto = false) {
  const session = currentSession();
  if (session.submitted) return;
  if (active && active.timer) {
    clearInterval(active.timer);
    active.timer = null;
  }

  const result = engine.gradeSession(session, { recordToStore: true, user: store.getUser() });
  engine.syncWrongBook(session, session.questions);
  if (auto) toast('已自动交卷');
  go(`result/${result.sessionId}`);
}

async function confirmSubmit() {
  const session = currentSession();
  const answered = engine.answeredCount(session);
  const total = session.questions.length;
  const rest = total - answered;
  const ok = await confirmDialog({
    title: '确认交卷',
    text: rest ? `还有 ${rest} 道题未作答，交卷后将无法修改。` : '所有题目均已作答，确认交卷？',
    okText: '交卷',
  });
  if (ok) submit();
}

function exitQuiz() {
  const session = state.getSession();
  if (!session || session.submitted) {
    destroyActive();
    go('home');
    return;
  }
  const answered = engine.answeredCount(session);
  if (!answered) {
    destroyActive();
    go('home');
    return;
  }
  confirmDialog({
    title: '退出答题',
    text: '退出后本次作答不会保存，确定退出？',
    okText: '退出',
  }).then((ok) => {
    if (ok) {
      destroyActive();
      go('home');
    }
  });
}

function selectOption(session, question, letter) {
  const isPractice = session.mode === 'practice';
  const revealed = Boolean(session.revealed[question.id]);

  if (revealed) return;

  if (question.type === 'multiple') {
    engine.toggleAnswer(session, question.id, letter);
    // 必须重渲染：底部「确认答案」的可用状态取决于当前选择
    rerender();
    return;
  }

  // 单选 / 判断题
  engine.setAnswer(session, question.id, [letter], question);

  if (!isPractice) {
    rerender();
    return;
  }

  // 练习模式：立即判分并锁定该题
  session.revealed[question.id] = true;
  session.feedback[question.id] = engine.applyInstantFeedback(question, session.answers[question.id]);

  const settings = store.getSettings();
  const isLast = session.currentIndex >= session.questions.length - 1;
  if (settings.autoNext && !isLast) {
    rerender();
    setTimeout(() => {
      const cur = state.getSession();
      if (!cur || cur.submitted || cur !== session) return;
      cur.currentIndex += 1;
      rerender();
    }, 650);
    return;
  }

  rerender();
}

/** 填空题/简答题：输入变化先存进会话（不重渲染，避免输入框失焦） */
function onTextChange(session, question, value) {
  if (session.revealed[question.id]) return;
  engine.setAnswer(session, question.id, value, question);

  // 练习模式下，一填完就把「确认答案」按钮点亮
  if (session.mode === 'practice') {
    const primary = document.querySelector('.footer-bar .btn--primary');
    if (primary) primary.disabled = !engine.hasAnswer(session.answers[question.id]);
  }
}

/** 填空题/简答题：点击「确认答案」后判分或标记待自评 */
function confirmText(session, question) {
  const raw = session.answers[question.id];
  if (!engine.hasAnswer(raw)) {
    toast(question.type === 'fill' ? '请先填写答案' : '请先作答');
    return;
  }

  if (session.mode !== 'practice') {
    rerender();
    return;
  }

  session.revealed[question.id] = true;
  // 简答题不自动判分，返回 null 表示待自评
  session.feedback[question.id] = engine.applyInstantFeedback(question, raw);
  rerender();
}

/** 多选题：确认后揭晓答案 */
function confirmOptionAnswer(session, question) {
  if (!engine.hasAnswer(session.answers[question.id])) {
    toast('请先选择答案');
    return;
  }
  session.revealed[question.id] = true;
  session.feedback[question.id] = engine.applyInstantFeedback(question, session.answers[question.id]);
  rerender();
}

/* ------------------------------------------------------------------ */
/* 参考答案要点 / 已掌握标记                                            */
/* ------------------------------------------------------------------ */

/** 把参考答案按「踩点」逐条列出；没有要点时返回 null */
function answerPointsNode(q) {
  const points = Array.isArray(q.points) ? q.points : [];
  if (points.length < 2) return null;
  return h('div.points', null, [
    h('div.points__title', { text: `参考答案要点（${points.length} 点，踩点给分）` }),
    h(
      'ol.points__list',
      null,
      points.map((p) => h('li.points__item', { text: p }))
    ),
  ]);
}

/** 主观题自评：标记「已掌握」后自动移出错题本 */
function masteryRow(q) {
  const mastered = store.isMastered(q.id);
  return h('div.mastery-row', null, [
    mastered
      ? h('span.mastery-done', { text: '✓ 已标记为掌握' })
      : h('button.btn.btn--sm.btn--primary', {
          type: 'button',
          text: '👍 我已掌握这题',
          onclick: () => {
            store.markMastered(q.id);
            store.removeWrong(q.id);
            toast('已标记为掌握');
            rerender();
          },
        }),
    h('span.mastery-hint', { text: '标记后会从错题本移出，可在「我的」查看掌握进度' }),
  ]);
}

/** 填空题输入框 */
function fillInput(session, question) {
  const value = typeof session.answers[question.id] === 'string' ? session.answers[question.id] : '';
  const input = h('input.input.fill-input', {
    type: 'text',
    value,
    placeholder: '在此填写答案',
    autocomplete: 'off',
    disabled: Boolean(session.revealed[question.id]),
    oninput: (e) => onTextChange(session, question, e.target.value),
  });
  return h('div.fill-box', null, [input]);
}

/** 简答题文本框 */
function shortInput(session, question) {
  const value = typeof session.answers[question.id] === 'string' ? session.answers[question.id] : '';
  const area = h('textarea.input.short-input', {
    rows: '5',
    placeholder: '在此作答（简答题不自动判分，交卷后可与参考答案自行对照）',
    disabled: Boolean(session.revealed[question.id]),
    oninput: (e) => onTextChange(session, question, e.target.value),
  });
  area.value = value;
  return h('div.fill-box', null, [area]);
}

function rerender() {
  const node = renderQuiz();
  const root = document.getElementById('app');
  const scrollTop = window.scrollY;
  root.replaceChildren(node);
  window.scrollTo(0, Math.min(scrollTop, node.scrollHeight));
}

/** 供答题卡等外部页面刷新答题视图（并回到答题页） */
export function rerenderQuiz() {
  if (!state.getSession()) {
    go('home');
    return;
  }
  rerender();
}

function renderQuiz() {
  const session = currentSession();
  const q = session.questions[session.currentIndex];
  const total = session.questions.length;
  const answered = engine.answeredCount(session);
  const isExam = session.mode === 'exam';
  const revealed = Boolean(session.revealed[q.id]);
  const qType = engine.normalizeType(q.type);
  const isTextType = qType === 'fill' || qType === 'short';
  const userAnswer = isTextType ? [] : engine.normalizeAnswer(session.answers[q.id]);
  const myText = typeof session.answers[q.id] === 'string' ? session.answers[q.id] : '';
  const opts = Array.isArray(q.options) ? q.options : [];
  const order = isTextType ? [] : session.optionOrder[q.id] || opts.map((_, i) => engine.LETTERS[i]);
  const byLetter = new Map((Array.isArray(q.options) ? q.options : []).map((text, i) => [engine.LETTERS[i], text]));

  const headerEl = header({
    title: session.title,
    onBack: exitQuiz,
    extra: `${session.currentIndex + 1}/${total}`,
  });

  const timerNode = isExam
    ? h('span.quiz-meta__timer', {
        'data-role': 'timer',
        text: fmtClock(session.remainingSec),
        class: session.remainingSec <= 60 ? 'quiz-meta__timer--warn' : '',
      })
    : null;

  const meta = h('div.quiz-meta', null, [
    h('div.quiz-meta__top', null, [
      h('span', { text: `已答 ${answered}/${total}` }),
      isExam ? h('span', null, ['剩余 ', timerNode]) : h('span', { text: engine.typeLabel(q.type) }),
    ]),
    h('div.progress', null, [
      h('div.progress__bar', { style: { width: `${percent(answered, total)}%` } }),
    ]),
  ]);

  const optionNodes = order.map((letter) => {
    const selected = userAnswer.includes(letter);
    const isRight = engine.normalizeAnswer(q.answer).includes(letter);
    let cls = 'option';
    if (revealed) {
      cls += ' option--disabled';
      if (isRight) cls += ' option--right';
      else if (selected) cls += ' option--wrong';
    } else if (selected) {
      cls += ' option--selected';
    }
    return h(
      `button.${cls.split(' ').join('.')}`,
      {
        type: 'button',
        disabled: revealed,
        onclick: () => selectOption(session, q, letter),
      },
      [
        h('span.option__key', { text: letter }),
        h('span.option__text', { text: byLetter.get(letter) }),
      ]
    );
  });

  const stemCard = h('div.stem', null, [
    h('div.stem__head', null, [
      h('span.stem__index', { text: `第 ${session.currentIndex + 1} 题` }),
      h('span.stem__type', { text: engine.typeLabel(q.type) }),
      tag(engine.DIFFICULTIES[q.difficulty].label, engine.DIFFICULTIES[q.difficulty].color),
    ]),
    h('div.stem__text', { text: q.stem }),
    isTextType
      ? qType === 'fill'
        ? fillInput(session, q)
        : shortInput(session, q)
      : h('div.options', null, optionNodes),
  ]);

  let feedbackNode = null;
  if (revealed) {
    const ok = session.feedback[q.id];
    const pointsNode = answerPointsNode(q);

    if (ok === null) {
      // 简答题：不自动判分，展示参考答案要点供自评
      feedbackNode = h('div.feedback.feedback--pending', null, [
        h('div.feedback__title', { text: '📝 简答题 · 对照要点自评' }),
        pointsNode ||
          h('div.feedback__line', null, [
            '参考答案：',
            h('span', { text: q.answerText || myText || '（未提供参考答案）' }),
          ]),
        h('div.feedback__line', null, ['评分提示：', h('span', { text: q.analysis })]),
        masteryRow(q),
      ]);
    } else {
      const mine = qType === 'fill' ? myText : userAnswer.join('、');
      const rightText =
        qType === 'fill'
          ? (Array.isArray(q.answer) ? q.answer.join(' / ') : String(q.answer))
          : engine.normalizeAnswer(q.answer).join('、');
      feedbackNode = h(`div.feedback.feedback--${ok ? 'right' : 'wrong'}`, null, [
        h('div.feedback__title', { text: ok ? '✅ 回答正确' : '❌ 回答错误' }),
        h('div.feedback__line', null, [
          '正确答案：',
          h('b', { text: rightText }),
          ` ｜ 你的答案：${mine || '未作答'}`,
        ]),
        h('div.feedback__line', null, ['解析：', h('span', { text: q.analysis })]),
      ]);
    }
  }

  const isLast = session.currentIndex >= total - 1;
  const hasMyAnswer = isTextType ? Boolean(myText.trim()) : userAnswer.length > 0;
  // 多选/填空/简答：练习模式下需要先「确认答案」再看结果
  const needConfirm = !isExam && !revealed && (qType === 'multiple' || qType === 'fill' || qType === 'short');

  const footer = h('div.footer-bar', null, [
    h('button.btn.btn--ghost', {
      type: 'button',
      text: '上一题',
      disabled: session.currentIndex === 0,
      onclick: () => {
        session.currentIndex = Math.max(0, session.currentIndex - 1);
        rerender();
      },
    }),
    needConfirm
      ? h('button.btn.btn--primary', {
          type: 'button',
          text: '确认答案',
          disabled: !hasMyAnswer,
          onclick: () => (isTextType ? confirmText(session, q) : confirmOptionAnswer(session, q)),
        })
      : isLast
        ? h('button.btn.btn--primary', {
            type: 'button',
            text: isExam ? '交卷' : '查看成绩',
            onclick: () => (isExam ? confirmSubmit() : submit()),
          })
        : h('button.btn.btn--primary', {
            type: 'button',
            text: '下一题',
            onclick: () => {
              session.currentIndex = Math.min(total - 1, session.currentIndex + 1);
              rerender();
            },
          }),
    h('button.btn.btn--ghost', {
      type: 'button',
      style: { flex: '0 0 auto', padding: '0 12px' },
      text: '答题卡',
      onclick: () => go(`sheet?token=${encodeURIComponent(active ? active.token : '')}`),
    }),
  ]);

  // 考试模式：保存答题卡入口 + 收藏标记
  const extraHeaderBtn = h('button', {
    type: 'button',
    'aria-label': '标记本题',
    text: session.flags[q.id] ? '🔖' : '🏳️',
    onclick: () => {
      session.flags[q.id] = !session.flags[q.id];
      rerender();
    },
  });

  headerEl.replaceChildren(
    h('button.header__back', { type: 'button', 'aria-label': '返回', onclick: exitQuiz, text: '‹' }),
    h('h1.header__title', { text: session.title }),
    h('div.header__extra', null, [
      h('span', { text: `${session.currentIndex + 1}/${total}` }),
      extraHeaderBtn,
    ])
  );

  return h('div.page', null, [headerEl, meta, h('div.page__body', null, [stemCard, feedbackNode]), footer]);
}

/* ------------------------------------------------------------------ */
/* 答题卡                                                              */
/* ------------------------------------------------------------------ */

export function SheetView() {
  const session = state.getSession();
  if (!session) {
    return h('div.page', null, [
      header({ title: '答题卡', onBack: () => go('home') }),
      h('div.page__body', null, emptyState('📄', '当前没有正在进行的答题')),
    ]);
  }

  const isExam = session.mode === 'exam';
  const submitted = session.submitted;
  const detailMap = new Map(((session.result && session.result.detail) || []).map((d) => [d.questionId, d]));

  const grid = h(
    'div.sheet-grid',
    null,
    session.questions.map((q, i) => {
      const detail = detailMap.get(q.id);
      let cls = 'sheet-cell';
      if (submitted && detail) {
        cls += detail.correct ? ' sheet-cell--right' : ' sheet-cell--wrong';
      } else if (engine.isAnswered(session, q.id)) {
        cls += ' sheet-cell--answered';
      }
      if (i === session.currentIndex) cls += ' sheet-cell--current';
      if (session.flags && session.flags[q.id]) cls += ' sheet-cell--flag';
      return h(`button.${cls.split(' ').join('.')}`, {
        type: 'button',
        text: String(i + 1),
        onclick: () => {
          session.currentIndex = i;
          if (submitted) {
            go('home');
          } else {
            rerenderQuiz();
          }
        },
      });
    })
  );

  const answered = engine.answeredCount(session);

  const body = h('div.page__body.page__body--flush', null, [
    h('div.sheet-section', null, [
      h('div.sheet-section__title', {
        text: `共 ${session.questions.length} 题，已答 ${answered} 题，未答 ${session.questions.length - answered} 题`,
      }),
      grid,
    ]),
    h('div.sheet-legend', null, [
      legendItem('已作答', 'i-answered'),
      legendItem('未作答', ''),
      submitted ? legendItem('答对', 'i-right') : null,
      submitted ? legendItem('答错', 'i-wrong') : null,
      legendItem('已标记', 'i-flag'),
    ]),
  ]);

  const footer = h('div.footer-bar', null, [
    h('button.btn.btn--ghost', {
      type: 'button',
      text: submitted ? '返回解析' : '继续答题',
      onclick: () => back(),
    }),
    !submitted && isExam
      ? h('button.btn.btn--primary', { type: 'button', text: '交卷', onclick: () => confirmSubmit() })
      : null,
  ]);

  return h('div.page', null, [header({ title: '答题卡', onBack: () => back() }), body, footer]);
}

function legendItem(text, cls) {
  return h('span', null, [h(`i${cls ? `.${cls}` : ''}`), text]);
}

/* ------------------------------------------------------------------ */
/* 结果页                                                              */
/* ------------------------------------------------------------------ */

export function ResultView({ id }) {
  const record = store.getSession(id);
  const session = state.getSession();
  const isActive =
    session && session.result && (session.id === id || (!id && session.submitted)) ? session : null;

  const data = isActive ? session.result : record;
  if (!data) {
    return h('div.page', null, [
      header({ title: '成绩', onBack: () => go('history') }),
      h('div.page__body', null, emptyState('🔍', '没有找到这次答题记录')),
    ]);
  }

  const detail = data.detail || [];
  const tip =
    data.score >= 90
      ? '太强了，几乎满分！'
      : data.score >= 75
        ? '表现不错，继续保持'
        : data.score >= 60
          ? '刚刚及格，错题再刷一遍'
          : '别灰心，先把错题吃透';

  const board = h(
    `div.score-board${data.score >= 85 ? '.score-board--good' : data.score < 60 ? '.score-board--bad' : ''}`,
    null,
    [
      h('div.score-board__label', { text: '本次得分' }),
      h('div.score-board__value', null, [String(data.score), h('small', { text: '分' })]),
      h('div.score-board__tip', { text: tip }),
      h('div.score-board__grid', null, [
        h('div.score-board__cell', null, [
          h('b', { text: `${data.correct}/${data.total}` }),
          h('span', { text: '答对题数' }),
        ]),
        h('div.score-board__cell', null, [
          h('b', { text: `${data.accuracy}%` }),
          h('span', { text: '正确率' }),
        ]),
        h('div.score-board__cell', null, [
          h('b', { text: fmtDuration(data.durationSec) }),
          h('span', { text: '用时' }),
        ]),
      ]),
    ]
  );

  const wrongQuestions = data.detail ? data.detail.filter((d) => !d.correct) : [];

  const body = h('div.page__body', null, [
    board,
    h('div.card', null, [
      h('div.flex-between', null, [
        h('span.text-sm.text-muted', { text: '错题' }),
        h('span', { text: `${wrongQuestions.length} 道` }),
      ]),
      h('div.flex-between.mt-8', null, [
        h('span.text-sm.text-muted', { text: '未作答' }),
        h('span', { text: `${data.unanswered || 0} 道` }),
      ]),
      h('div.flex-between.mt-8', null, [
        h('span.text-sm.text-muted', { text: '完成时间' }),
        h('span', { text: fmtTime(data.gradedAt || (record && record.createdAt) || Date.now()) }),
      ]),
    ]),
    h('section.section', null, [
      h('div.section__head', null, [h('h2.section__title', { text: '逐题解析' })]),
      h(
        'div',
        null,
        detail.map((d, i) => analysisItem(d, i, session && session.id === id ? session : null))
      ),
    ]),
  ]);

  const wrongIds = wrongQuestions.map((d) => d.questionId);
  const footer = h('div.footer-bar', null, [
    h('button.btn.btn--ghost', {
      type: 'button',
      text: '返回首页',
      onclick: () => {
        destroyActive();
        go('home');
      },
    }),
    wrongIds.length
      ? h('button.btn.btn--primary', {
          type: 'button',
          text: `重做错题(${wrongIds.length})`,
          onclick: () => go(`quiz/wrong?ids=${wrongIds.join(',')}`),
        })
      : h('button.btn.btn--primary', {
          type: 'button',
          text: '再练一次',
          onclick: () => go('setup/practice'),
        }),
  ]);

  return h('div.page', null, [header({ title: '答题结果', onBack: () => go('home') }), body, footer]);
}

function analysisItem(d, index, session) {
  const q = getQuestion(d.questionId);
  if (!q) return null;
  const type = engine.normalizeType(q.type);
  const mine = engine.formatAnswer(q, d.userAnswer) || '未作答';

  // 简答题无自动判分，展示参考答案并标记为待自评
  const pending = d.pending || type === 'short';
  const right =
    type === 'short'
      ? q.answerText || '（未提供参考答案）'
      : type === 'fill'
        ? Array.isArray(d.rightAnswer)
          ? d.rightAnswer.join(' / ')
          : String(d.rightAnswer || '')
        : engine.normalizeAnswer(d.rightAnswer).join('、');

  return h('div.analysis-item', null, [
    h('div.analysis-item__head', null, [
      h('span.analysis-item__no', { text: `第 ${index + 1} 题` }),
      pending
        ? tag('待自评', 'medium')
        : tag(d.correct ? '答对' : '答错', d.correct ? 'easy' : 'hard'),
      tag(engine.typeLabel(q.type)),
      tag(engine.DIFFICULTIES[q.difficulty].label, engine.DIFFICULTIES[q.difficulty].color),
      store.isMastered(q.id) ? tag('已掌握', 'easy') : null,
    ]),
    h('div.analysis-item__stem', { text: q.stem }),
    // 有要点的主观题：逐条列出参考答案要点（手机上更好背）
    q.points && q.points.length >= 2
      ? h('div.points', null, [
          h('div.points__title', { text: `参考答案要点（${q.points.length} 点，踩点给分）` }),
          h(
            'ol.points__list',
            null,
            q.points.map((p) => h('li.points__item', { text: p }))
          ),
        ])
      : h('div.analysis-item__answer', null, [
          type === 'short' ? '参考答案：' : '正确答案：',
          h('em', { text: right }),
        ]),
    h('div.analysis-item__answer', null, [
      '你的答案：',
      h(`em${d.correct || pending ? '' : '.mine-wrong'}`, { text: mine }),
    ]),
    h('div.analysis-item__analysis', null, [h('b', { text: '解析：' }), q.analysis]),
    session
      ? h('button.btn.btn--sm.btn--outline.mt-8', {
          type: 'button',
          text: '回到这题',
          onclick: () => {
            session.currentIndex = index;
            go('sheet');
          },
        })
      : null,
  ]);
}

/* ------------------------------------------------------------------ */
/* 错题单题回顾                                                        */
/* ------------------------------------------------------------------ */

export function ReviewView({ id }) {
  const q = getQuestion(id);
  if (!q) {
    return h('div.page', null, [
      header({ title: '题目回顾', onBack: () => go('wrong') }),
      h('div.page__body', null, emptyState('🔍', '题目不存在')),
    ]);
  }

  const item = store.getWrongBook().find((w) => w.questionId === id);
  const byLetter = new Map((Array.isArray(q.options) ? q.options : []).map((text, i) => [engine.LETTERS[i], text]));
  const qType = engine.normalizeType(q.type);
  const isTextType = qType === 'fill' || qType === 'short';
  const rightText = isTextType
    ? Array.isArray(q.answer)
      ? q.answer.join(' / ')
      : String(q.answerText || q.answer || '（未提供参考答案）')
    : engine.normalizeAnswer(q.answer).join('、');

  const body = h('div.page__body', null, [
    h('div.stem', null, [
      h('div.stem__head', null, [
        tag(engine.typeLabel(q.type), 'primary'),
        tag(engine.DIFFICULTIES[q.difficulty].label, engine.DIFFICULTIES[q.difficulty].color),
        item ? tag(`错 ${item.wrongCount} 次`, 'hard') : null,
      ]),
      h('div.stem__text', { text: q.stem }),
      isTextType
        ? null
        : h(
            'div.options',
            null,
            (Array.isArray(q.options) ? q.options : []).map((_, i) => {
              const letter = engine.LETTERS[i];
              const isRight = engine.normalizeAnswer(q.answer).includes(letter);
              const isMine = item && engine.normalizeAnswer(item.lastAnswer).includes(letter);
              let cls = 'option option--disabled';
              if (isRight) cls += ' option--right';
              else if (isMine) cls += ' option--wrong';
              return h(`div.${cls.split(' ').join('.')}`, null, [
                h('span.option__key', { text: letter }),
                h('span.option__text', { text: byLetter.get(letter) }),
              ]);
            })
          ),
    ]),
    h('div.feedback.feedback--right.mt-12', null, [
      h('div.feedback__title', { text: qType === 'short' ? '参考答案' : '正确答案' }),
      q.points && q.points.length >= 2
        ? h('div.points', null, [
            h('div.points__title', { text: `参考答案要点（${q.points.length} 点）` }),
            h(
              'ol.points__list',
              null,
              q.points.map((p) => h('li.points__item', { text: p }))
            ),
          ])
        : h('div.feedback__line', null, [h('b', { text: rightText })]),
      item
        ? h('div.feedback__line', null, [
            qType === 'short' || qType === 'fill' ? '你上次填写：' : '你上次选择了：',
            h('b', { text: engine.formatAnswer(q, item.lastAnswer) || '未作答' }),
          ])
        : null,
      h('div.feedback__line', null, ['解析：', h('span', { text: q.analysis })]),
    ]),
  ]);

  const footer = h('div.footer-bar', null, [
    h('button.btn.btn--danger', {
      type: 'button',
      text: '移出错题本',
      onclick: () => {
        store.removeWrong(q.id);
        toast('已移出错题本');
        go('wrong');
      },
    }),
    h('button.btn.btn--primary', {
      type: 'button',
      text: '我记住了，下一题',
      onclick: () => {
        store.removeWrong(q.id);
        go('wrong');
      },
    }),
  ]);

  return h('div.page', null, [header({ title: '错题回顾', onBack: () => go('wrong') }), body, footer]);
}
