/**
 * 首页 / 底部标签页（首页、错题本、记录、我的）
 */

import { h, header, tabbar, tag, progressBar, emptyState, toast, confirmDialog } from '../ui/ui.js';
import * as store from '../core/store.js';
import * as auth from '../services/auth.js';
import { CHAPTERS, QUESTIONS, chapterStats, getQuestion } from '../data/questions.js';
import { SUBJECTS, getSubject, chapterIdsOfSubject } from '../data/subjects.js';
import * as engine from '../core/engine.js';
import { fmtTime, fmtDuration, percent } from '../core/utils.js';
import { go } from '../app.js';

function chapterProgress(chapterId) {
  const sessions = store.getSessions().filter((s) => s.chapterId === chapterId);
  const done = new Set();
  sessions.forEach((s) => (s.detail || []).forEach((d) => done.add(d.questionId)));
  // 单题练习与「已掌握」标记的题目也计入本章进度
  store.getMasteredIds().forEach((id) => {
    const q = getQuestion(id);
    if (q && q.chapterId === chapterId) done.add(id);
  });
  const total = chapterStats(chapterId).total;
  return { done: done.size, total, percent: percent(done.size, total) };
}

/** 主观题掌握进度：冲刺阶段用它判断还差多少 */
function subjectiveProgress() {
  const subjective = QUESTIONS.filter((q) => q.type === 'short' || q.type === 'judge');
  const mastered = store.getMasteredIds().filter((id) => {
    const q = getQuestion(id);
    return q && (q.type === 'short' || q.type === 'judge');
  });
  return {
    total: subjective.length,
    mastered: mastered.length,
    percent: percent(mastered.length, subjective.length),
  };
}

/* ------------------------------------------------------------------ */
/* 首页                                                                */
/* ------------------------------------------------------------------ */

export function HomeView() {
  const user = store.getUser();
  const stats = store.getStats();
  const sessions = store.getSessions();
  const wrongList = store.getWrongBook();
  const logged = auth.isLoggedIn();

  const hero = h('section.hero', null, [
    logged
      ? null
      : h('button.hero__login', {
          type: 'button',
          text: '登录 ›',
          onclick: () => go('login'),
        }),
    h('div.hero__greet', { text: logged ? '欢迎回来' : '你好，欢迎使用' }),
    h('div.hero__name', { text: user.nickname || '答题闯关' }),
    h('div.hero__stats', null, [
      h('div.hero__stat', null, [
        h('b', { text: String(stats.answered || 0) }),
        h('span', { text: '累计答题' }),
      ]),
      h('div.hero__stat', null, [
        h('b', { text: `${percent(stats.correct, stats.answered)}%` }),
        h('span', { text: '正确率' }),
      ]),
      h('div.hero__stat', null, [
        h('b', { text: String(stats.streakDays || 0) }),
        h('span', { text: '连续天数' }),
      ]),
    ]),
  ]);

  // 主观题掌握进度：冲刺阶段最关心的一个数字
  const subj = subjectiveProgress();
  const subjectiveCard = h('div.card', null, [
    h('div.flex-between', null, [
      h('div.list__title', { text: '主观题掌握进度' }),
      h('span.tag.tag--primary', { text: `${subj.mastered}/${subj.total}` }),
    ]),
    progressBar(subj.percent, subj.percent >= 80 ? 'green' : subj.percent >= 40 ? 'orange' : ''),
    h('div.list__sub.mt-8', {
      text: subj.mastered
        ? `已掌握 ${subj.mastered} 道（辨析题 + 简答论述），继续把剩下的过一遍`
        : '辨析题与简答论述占政治 80 分。做完后在解析页点「我已掌握这题」即可累计',
    }),
    h('div.mt-12', null, [
      h('button.btn.btn--sm.btn--outline', {
        type: 'button',
        text: '去刷辨析题专项 ›',
        onclick: () => go('chapter/subj-bx'),
      }),
    ]),
  ]);

  const modeGrid = h('div.mode-grid', null, [
    modeCard('📚', '题库分类', '政治 / 英语两大板块，按考点逐章刷', () => go('subjects')),
    modeCard('🎯', '答题技巧', '分题型作答法、作文句型、考场规范', () => go('strategy')),
    modeCard('🎲', '随机组卷', '按板块抽题，自选章节与难度', () => go('setup/practice')),
    modeCard('📝', '模拟考试', `限时 ${store.getSettings().examDurationMin} 分钟，交卷判分`, () =>
      go('setup/exam')
    ),
    modeCard('📕', '错题复习', `共 ${wrongList.length} 道错题待攻克`, () => go('wrong')),
    modeCard('📊', '答题记录', '历史成绩、正确率与逐题解析', () => go('history')),
  ]);

  // 两大板块入口
  const subjectCards = SUBJECTS.map((subject) => {
    const ids = chapterIdsOfSubject(subject.id);
    let done = 0;
    let total = 0;
    for (const cid of ids) {
      const p = chapterProgress(cid);
      done += p.done;
      total += p.total;
    }
    const pct = percent(done, total);
    return h('button.subject-bar', { type: 'button', onclick: () => go(`subject/${subject.id}`) }, [
      h('span.subject-bar__icon', { text: subject.icon }),
      h('div.list__main', null, [
        h('div.flex-between', null, [
          h('div.list__title', { text: subject.name }),
          h('span.tag.tag--primary', { text: `${total} 题` }),
        ]),
        progressBar(pct),
        h('div.list__sub', { text: `已练 ${done}/${total}` }),
      ]),
      h('span.list__arrow', { text: '›' }),
    ]);
  });

  const recent = sessions.slice(0, 3);

  const body = h('div.page__body', null, [
    h('section.section', null, [
      h('div.section__head', null, [
        h('h2.section__title', { text: '题库板块' }),
        h('a.section__more', { href: '#/subjects', text: '全部 ›' }),
      ]),
      h('div.subject-bars', null, subjectCards),
    ]),
    h('div.mt-16', null, subjectiveCard),
    modeGrid,
    recent.length
      ? h('section.section', null, [
          h('div.section__head', null, [
            h('h2.section__title', { text: '最近记录' }),
            h('a.section__more', { href: '#/history', text: '全部 ›' }),
          ]),
          h(
            'div.list',
            null,
            recent.map((s) =>
              h('button.list__item', { type: 'button', onclick: () => go(`result/${s.id}`) }, [
                h('div.list__main', null, [
                  h('div.list__title', { text: s.title || '练习' }),
                  h('div.list__sub', {
                    text: `${fmtTime(s.createdAt)} · ${s.correct}/${s.total} 题 · ${fmtDuration(s.durationSec)}`,
                  }),
                ]),
                h('span.tag.tag--primary', { text: `${s.score} 分` }),
              ])
            )
          ),
        ])
      : null,
  ]);

  return h('div.page', null, [hero, body, tabbar('home')]);
}

function modeCard(icon, title, desc, onclick) {
  return h('button.mode-card', { type: 'button', onclick }, [
    h('span.mode-card__icon', { text: icon }),
    h('span.mode-card__title', { text: title }),
    h('span.mode-card__desc', { text: desc }),
  ]);
}

/* ------------------------------------------------------------------ */
/* 章节列表                                                            */
/* ------------------------------------------------------------------ */

export function ChaptersView() {
  const body = h(
    'div.page__body',
    null,
    h(
      'div.list',
      null,
      CHAPTERS.map((chapter) => {
        const st = chapterStats(chapter.id);
        const prog = chapterProgress(chapter.id);
        return h('button.list__item', { type: 'button', onclick: () => go(`chapter/${chapter.id}`) }, [
          h('div.chapter-row__icon', { text: chapter.icon }),
          h('div.list__main', null, [
            h('div.list__title', { text: chapter.name }),
            h('div.list__sub', { text: chapter.desc }),
            h('div.tag-row.mt-8', null, [
              tag(`${st.total} 题`, 'primary'),
              tag(`简单 ${st.easy}`, 'easy'),
              tag(`中等 ${st.medium}`, 'medium'),
              tag(`困难 ${st.hard}`, 'hard'),
            ]),
            progressBar(prog.percent),
          ]),
          h('span.list__arrow', { text: '›' }),
        ]);
      })
    )
  );

  return h('div.page', null, [
    header({ title: '章节练习', onBack: () => go('home') }),
    body,
    tabbar('home'),
  ]);
}

/* ------------------------------------------------------------------ */
/* 单章节详情                                                          */
/* ------------------------------------------------------------------ */

export function ChapterView({ id }) {
  const chapter = CHAPTERS.find((c) => c.id === id);
  if (!chapter) return NotFoundView();

  const st = chapterStats(id);
  const prog = chapterProgress(id);
  const sessions = store.getSessions().filter((s) => s.chapterId === id).slice(0, 3);

  const body = h('div.page__body', null, [
    h('div.card', null, [
      h('div.flex-between', null, [
        h('div', null, [
          h('div.list__title', { text: `${chapter.icon} ${chapter.name}` }),
          h('div.list__sub', { text: chapter.desc }),
        ]),
      ]),
      h('div.tag-row.mt-12', null, [
        tag(`${st.total} 题`, 'primary'),
        tag(`简单 ${st.easy}`, 'easy'),
        tag(`中等 ${st.medium}`, 'medium'),
        tag(`困难 ${st.hard}`, 'hard'),
      ]),
      h('div.mt-12', null, [
        h('div.list__sub', { text: `练习进度 ${prog.done}/${prog.total}` }),
        progressBar(prog.percent),
      ]),
    ]),
    h('div.mt-16', null, [
      h('button.btn.btn--primary.btn--block', {
        type: 'button',
        text: '开始顺序练习',
        onclick: () => go(`quiz/chapter/${id}`),
      }),
    ]),
    sessions.length
      ? h('section.section', null, [
          h('div.section__head', null, [h('h2.section__title', { text: '本章最近记录' })]),
          h(
            'div.list',
            null,
            sessions.map((s) =>
              h('button.list__item', { type: 'button', onclick: () => go(`result/${s.id}`) }, [
                h('div.list__main', null, [
                  h('div.list__title', { text: `${s.correct}/${s.total} 题正确` }),
                  h('div.list__sub', {
                    text: `${fmtTime(s.createdAt)} · ${fmtDuration(s.durationSec)}`,
                  }),
                ]),
                h('span.tag.tag--primary', { text: `${s.score} 分` }),
              ])
            )
          ),
        ])
      : null,
  ]);

  return h('div.page', null, [
    header({ title: chapter.name, onBack: () => go('chapters') }),
    body,
  ]);
}

/* ------------------------------------------------------------------ */
/* 组卷配置                                                            */
/* ------------------------------------------------------------------ */

const setupState = {
  subject: 'politics', // 科目：政治 / 英语。组卷只在同一科目内抽题
  chapters: [],
  difficulties: [],
  count: 10,
  durationMin: 10,
};

export function SetupView({ mode = 'practice', subject = null } = {}) {
  const isExam = mode === 'exam';
  const maxCount = 200;
  setupState.count = isExam ? store.getSettings().examQuestionCount : 10;
  setupState.durationMin = store.getSettings().examDurationMin;

  // 进入组卷页时重置：科目取传入值，章节清空（章节列表随科目变化）
  setupState.subject = subject && getSubject(subject) ? subject : setupState.subject;
  if (!getSubject(setupState.subject)) setupState.subject = SUBJECTS[0].id;
  setupState.chapters = [];

  /** 当前科目下的章节（只列题库里确实有题的） */
  function subjectChapters() {
    return chapterIdsOfSubject(setupState.subject)
      .map((id) => CHAPTERS.find((c) => c.id === id))
      .filter((c) => c && chapterStats(c.id).total > 0);
  }

  const subjectPicker = h(
    'div.tag-row',
    null,
    SUBJECTS.map((s) =>
      h(
        `button.btn.btn--sm${setupState.subject === s.id ? '.btn--primary' : '.btn--ghost'}`,
        {
          type: 'button',
          text: `${s.icon} ${s.name}`,
          onclick: (e) => {
            if (setupState.subject === s.id) return;
            setupState.subject = s.id;
            setupState.chapters = [];
            e.currentTarget.parentElement
              .querySelectorAll('button')
              .forEach((b) => { b.className = 'btn btn--sm btn--ghost'; });
            e.currentTarget.className = 'btn btn--sm btn--primary';
            // 章节列表与可用题量都要跟着换
            renderChapterPicker();
            updateSummary();
          },
        }
      )
    )
  );

  const chapterPicker = h('div.tag-row', null, []);

  /** 章节选择器：内容随当前科目重建 */
  function renderChapterPicker() {
    chapterPicker.textContent = '';
    const list = subjectChapters();
    if (!list.length) {
      chapterPicker.appendChild(
        h('span.form-field__hint', { text: '该板块下暂无可用章节' })
      );
      return;
    }
    list.forEach((c) => {
      const st = chapterStats(c.id);
      const on = setupState.chapters.includes(c.id);
      chapterPicker.appendChild(
        h(`button.btn.btn--sm${on ? '.btn--primary' : '.btn--ghost'}`, {
          type: 'button',
          text: `${c.name}（${st.total}）`,
          onclick: (e) => {
            const i = setupState.chapters.indexOf(c.id);
            if (i >= 0) setupState.chapters.splice(i, 1);
            else setupState.chapters.push(c.id);
            e.currentTarget.className = `btn btn--sm ${
              setupState.chapters.includes(c.id) ? 'btn--primary' : 'btn--ghost'
            }`;
            updateSummary();
          },
        })
      );
    });
  }

  const diffPicker = h(
    'div.tag-row',
    null,
    Object.values(engine.DIFFICULTIES).map((d) =>
      h(
        `button.btn.btn--sm${setupState.difficulties.includes(d.key) ? '.btn--primary' : '.btn--ghost'}`,
        {
          type: 'button',
          text: d.label,
          onclick: (e) => {
            const i = setupState.difficulties.indexOf(d.key);
            if (i >= 0) setupState.difficulties.splice(i, 1);
            else setupState.difficulties.push(d.key);
            e.currentTarget.className = `btn btn--sm ${
              setupState.difficulties.includes(d.key) ? 'btn--primary' : 'btn--ghost'
            }`;
            updateSummary();
          },
        }
      )
    )
  );

  const countInput = h('input.input', {
    type: 'number',
    min: '1',
    max: String(maxCount),
    value: String(setupState.count),
    oninput: (e) => {
      setupState.count = Math.max(1, Math.min(maxCount, Number(e.target.value) || 1));
      updateSummary();
    },
  });
  const durationInput = h('input.input', {
    type: 'number',
    min: '1',
    max: '120',
    value: String(setupState.durationMin),
    oninput: (e) => {
      setupState.durationMin = Math.max(1, Math.min(120, Number(e.target.value) || 1));
    },
  });

  const summary = h('div.tag.tag--primary', { text: '' });
  /** 按当前筛选出的题型构成估算建议时长 */
  const estimateHint = h('div.form-field__hint', { text: '' });

  function currentEstimate() {
    return engine.estimateMinutes(QUESTIONS_FILTERED().slice(0, setupState.count));
  }

  function updateSummary() {
    const pool = availableCount();
    summary.textContent = `可抽题 ${pool} 道`;
    const est = currentEstimate();
    if (isExam) {
      const current = Number(durationInput.value) || 0;
      estimateHint.textContent =
        current === est
          ? `建议时长 ${est} 分钟（已采用）· 按选择题 3.5 分钟、简答 10 分钟、论述 20 分钟估算`
          : `按题型估算建议 ${est} 分钟，点击右侧按钮采用`;
    } else {
      estimateHint.textContent = `按当前题量估算约需 ${est} 分钟`;
    }
  }
  updateSummary();

  function availableCount() {
    return QUESTIONS_FILTERED().length;
  }

  const applyEstimateBtn = h('button.btn.btn--sm.btn--outline', {
    type: 'button',
    text: '用建议时长',
    onclick: () => {
      const est = currentEstimate();
      setupState.durationMin = est;
      durationInput.value = String(est);
      updateSummary();
      toast(`已设为建议时长 ${est} 分钟`);
    },
  });

  const body = h('div.page__body', null, [
    h('div.card', null, [
      h('div.form-field', null, [
        h('label.form-field__label', { text: '选择板块' }),
        subjectPicker,
        h('div.form-field__hint', { text: '只在本板块内抽题，政治与英语不会混在一份卷子里' }),
      ]),
      h('div.form-field', null, [
        h('label.form-field__label', { text: '选择章节（不选 = 本板块全部章节）' }),
        chapterPicker,
      ]),
      h('div.form-field', null, [
        h('label.form-field__label', { text: '选择难度（不选 = 全部难度）' }),
        diffPicker,
      ]),
      h('div.form-field', null, [
        h('label.form-field__label', { text: `题目数量（1 - ${maxCount}）` }),
        countInput,
      ]),
      isExam
        ? h('div.form-field', null, [
            h('label.form-field__label', { text: '考试时长（分钟）' }),
            h('div.duration-row', null, [durationInput, applyEstimateBtn]),
            estimateHint,
          ])
        : h('div.form-field', null, [
            h('label.form-field__label', { text: '预计用时' }),
            estimateHint,
          ]),
      h('div.flex-between.mt-8', null, [summary]),
    ]),
  ]);

  const startBtn = h('button.btn.btn--primary', {
    type: 'button',
    text: isExam ? '开始考试' : '开始练习',
    onclick: () => {
      const list = QUESTIONS_FILTERED();
      if (!list.length) {
        toast('当前筛选条件下没有题目，请调整条件');
        return;
      }
      store.saveSettings(
        isExam
          ? { examQuestionCount: setupState.count, examDurationMin: setupState.durationMin }
          : {}
      );
      const params = new URLSearchParams();
      params.set('s', setupState.subject);
      if (setupState.chapters.length) params.set('c', setupState.chapters.join(','));
      if (setupState.difficulties.length) params.set('d', setupState.difficulties.join(','));
      params.set('n', String(setupState.count));
      if (isExam) params.set('t', String(setupState.durationMin));
      go(`${isExam ? 'quiz/exam' : 'quiz/random'}?${params.toString()}`);
    },
  });

  // 章节列表随科目初始化
  renderChapterPicker();

  return h('div.page', null, [
    header({ title: isExam ? '模拟考试设置' : '随机组卷', onBack: () => go('home') }),
    body,
    h('div.footer-bar', null, [startBtn]),
  ]);
}

// 在 SetupView 内引用题库：只抽**当前科目**下的题，避免政治与英语混卷
function QUESTIONS_FILTERED() {
  const allowed = new Set(chapterIdsOfSubject(setupState.subject));
  return QUESTIONS.filter((q) => {
    if (!allowed.has(q.chapterId)) return false;
    if (setupState.chapters.length && !setupState.chapters.includes(q.chapterId)) return false;
    if (setupState.difficulties.length && !setupState.difficulties.includes(q.difficulty)) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* 错题本                                                              */
/* ------------------------------------------------------------------ */

export function WrongView({ auto = false } = {}) {
  const list = store.getWrongBook();
  const questions = list.map((item) => ({ item, question: getQuestion(item.questionId) })).filter((x) => x.question);

  const startBtn = h('button.btn.btn--primary', {
    type: 'button',
    text: list.length ? '开始复习（按错次排序）' : '暂无错题',
    disabled: !list.length,
    onclick: () => {
      const ids = questions
        .slice()
        .sort((a, b) => b.item.wrongCount - a.item.wrongCount)
        .map((x) => x.question.id);
      go(`quiz/wrong?ids=${ids.join(',')}`);
    },
  });

  const body = h('div.page__body', null, [
    list.length
      ? h(
          'div.list',
          null,
          questions.map(({ item, question }) =>
            h('button.list__item', { type: 'button', onclick: () => go(`review/${question.id}`) }, [
              h('div.list__main', null, [
                h('div.list__title', { text: question.stem }),
                h('div.tag-row.mt-8', null, [
                  tag(engine.typeLabel(question.type)),
                  tag(engine.DIFFICULTIES[question.difficulty].label, engine.DIFFICULTIES[question.difficulty].color),
                  tag(`错 ${item.wrongCount} 次`, 'hard'),
                  tag(fmtTime(item.lastWrongAt)),
                ]),
              ]),
              h('span.list__arrow', { text: '›' }),
            ])
          )
        )
      : emptyState('🎉', '错题本是空的，继续保持！\n答错的题会自动收录到这里。'),
  ]);

  const actions = h('div.footer-bar', null, [
    startBtn,
    list.length
      ? h('button.btn.btn--danger', {
          style: { flex: '0 0 auto', padding: '0 16px' },
          type: 'button',
          text: '清空',
          onclick: async () => {
            const ok = await confirmDialog({ title: '清空错题本', text: '清空后无法恢复，确定继续？' });
            if (!ok) return;
            store.clearWrongBook();
            toast('错题本已清空');
            go('wrong');
          },
        })
      : null,
  ]);

  return h('div.page', null, [
    header({ title: '错题本', onBack: auto ? null : () => go('home'), extra: `${list.length} 道` }),
    body,
    actions,
    tabbar('wrong'),
  ]);
}

/* ------------------------------------------------------------------ */
/* 答题记录                                                            */
/* ------------------------------------------------------------------ */

export function HistoryView() {
  const sessions = store.getSessions();
  const stats = store.getStats();

  const body = h('div.page__body', null, [
    h('div.stat-grid', null, [
      h('div.stat-box', null, [h('b', { text: String(stats.practice || 0) }), h('span', { text: '练习次数' })]),
      h('div.stat-box', null, [h('b', { text: String(stats.exams || 0) }), h('span', { text: '考试次数' })]),
      h('div.stat-box', null, [
        h('b', { text: String(stats.bestScore || 0) }),
        h('span', { text: '最高分' }),
      ]),
      h('div.stat-box', null, [
        h('b', { text: fmtDuration(stats.totalDurationSec || 0) }),
        h('span', { text: '累计用时' }),
      ]),
    ]),
    sessions.length
      ? h('section.section', null, [
          h('div.section__head', null, [
            h('h2.section__title', { text: `答题记录（${sessions.length}）` }),
            h('button.section__more', {
              type: 'button',
              text: '清空',
              onclick: async () => {
                const ok = await confirmDialog({ title: '清空记录', text: '将删除全部答题记录，确定继续？' });
                if (!ok) return;
                store.clearSessions();
                toast('记录已清空');
                go('history');
              },
            }),
          ]),
          h(
            'div.list',
            null,
            sessions.map((s) =>
              h('button.list__item', { type: 'button', onclick: () => go(`result/${s.id}`) }, [
                h('div.list__main', null, [
                  h('div.list__title', { text: s.title || '练习' }),
                  h('div.list__sub', {
                    text: `${fmtTime(s.createdAt)} · 正确 ${s.correct}/${s.total} · ${fmtDuration(
                      s.durationSec
                    )}`,
                  }),
                ]),
                h(
                  `span.tag.tag--${s.accuracy >= 80 ? 'easy' : s.accuracy >= 60 ? 'medium' : 'hard'}`,
                  { text: `${s.score} 分` }
                ),
              ])
            )
          ),
        ])
      : emptyState('📊', '还没有答题记录\n完成一次练习或考试后就会出现在这里。'),
  ]);

  return h('div.page', null, [header({ title: '答题记录' }), body, tabbar('history')]);
}

/* ------------------------------------------------------------------ */
/* 我的                                                                */
/* ------------------------------------------------------------------ */

export function ProfileView() {
  const user = store.getUser();
  const stats = store.getStats();
  const settings = store.getSettings();
  const logged = auth.isLoggedIn();

  const head = h('section.profile-head', null, [
    h('div.avatar', null, [
      user.avatar ? h('img', { src: user.avatar, alt: '头像' }) : document.createTextNode('🙂'),
    ]),
    h('div', null, [
      h('div.profile-head__name', { text: user.nickname || '未登录用户' }),
      h('div.profile-head__sub', {
        text: logged
          ? user.provider === 'wechat-demo'
            ? '微信登录（演示模式）'
            : user.provider === 'wechat'
              ? '微信登录'
              : '本地账号'
          : '登录后可同步成绩到云端',
      }),
    ]),
  ]);

  const body = h('div.page__body', null, [
    head,
    h('div.stat-grid.mt-16', null, [
      h('div.stat-box', null, [
        h('b', { text: `${percent(stats.correct, stats.answered)}%` }),
        h('span', { text: '总正确率' }),
      ]),
      h('div.stat-box', null, [h('b', { text: String(stats.answered || 0) }), h('span', { text: '累计答题' })]),
    ]),
    h('section.section', null, [
      h('div.section__head', null, [h('h2.section__title', { text: '答题设置' })]),
      h('div.card', null, [
        switchRow(
          '单选自动下一题',
          '练习模式下作答后自动跳到下一题',
          settings.autoNext,
          (v) => store.saveSettings({ autoNext: v })
        ),
        switchRow(
          '考试打乱选项',
          '开启后单选题的选项顺序会随机',
          settings.shuffleOptions,
          (v) => store.saveSettings({ shuffleOptions: v })
        ),
      ]),
    ]),
    h('section.section', null, [
      h('div.section__head', null, [h('h2.section__title', { text: '账号' })]),
      h('div.list', null, [
        logged
          ? h('button.list__item', {
              type: 'button',
              onclick: async () => {
                const ok = await confirmDialog({ title: '退出登录', text: '退出后本地记录仍会保留。' });
                if (!ok) return;
                auth.logout();
                toast('已退出登录');
                go('profile');
              },
            }, [h('div.list__main', null, [h('div.list__title', { text: '退出登录' })]), h('span.list__arrow', { text: '›' })])
          : h('button.list__item', {
              type: 'button',
              onclick: () => go('login'),
            }, [
              h('div.list__main', null, [
                h('div.list__title', { text: '登录 / 注册' }),
                h('div.list__sub', { text: '本地账号或微信一键登录' }),
              ]),
              h('span.list__arrow', { text: '›' }),
            ]),
        h('button.list__item', {
          type: 'button',
          onclick: async () => {
            const ok = await confirmDialog({
              title: '重置本地数据',
              text: '将清除账号、成绩记录与错题本，确定继续？',
              okText: '重置',
            });
            if (!ok) return;
            store.resetAll();
            toast('本地数据已重置');
            go('home');
          },
        }, [
          h('div.list__main', null, [h('div.list__title', { text: '重置本地数据' })]),
          h('span.list__arrow', { text: '›' }),
        ]),
      ]),
    ]),
    h('p.text-center.text-muted.text-sm.mt-20', {
      text: '答题闯关 v1.0 · 数据存储：浏览器本地（localStorage）',
    }),
  ]);

  return h('div.page', null, [header({ title: '我的' }), body, tabbar('profile')]);
}

function switchRow(title, desc, value, onChange) {
  const sw = h(`div.switch${value ? '.switch--on' : ''}`);
  return h('div.switch-row', null, [
    h('div.switch-row__main', null, [
      h('div.switch-row__title', { text: title }),
      h('div.switch-row__desc', { text: desc }),
    ]),
    h('button.switch-btn', {
      type: 'button',
      'aria-label': title,
      onclick: () => {
        const next = !sw.classList.contains('switch--on');
        sw.classList.toggle('switch--on', next);
        onChange(next);
      },
    }, [sw]),
  ]);
}

/* ------------------------------------------------------------------ */
/* 404                                                                 */
/* ------------------------------------------------------------------ */

export function NotFoundView() {
  return h('div.page', null, [
    header({ title: '页面不存在', onBack: () => go('home') }),
    h('div.page__body', null, emptyState('🧭', '没有找到这个页面')),
  ]);
}
