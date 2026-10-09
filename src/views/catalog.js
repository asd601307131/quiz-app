/**
 * 科目导航与答题技巧视图。
 *
 *   #/subjects              两大板块入口（政治 / 英语）
 *   #/subject/:id           科目详情：按分组列出章节
 *   #/strategy              答题技巧板块首页
 *   #/strategy/:id          技巧条目详情（内容讲解）
 */

import { h, header, tabbar, tag, progressBar, emptyState, toast } from '../ui/ui.js';
import * as store from '../core/store.js';
import * as engine from '../core/engine.js';
import { getQuestion, chapterStats, CHAPTERS } from '../data/questions.js';
import { SUBJECTS, getSubject, chapterIdsOfSubject } from '../data/subjects.js';
import {
  STRATEGY_SUBJECTS,
  STRATEGY_TOPICS,
  getStrategySubject,
  getStrategyTopic,
  topicsOfSubject,
} from '../data/strategy.js';
import { percent } from '../core/utils.js';
import { go } from '../app.js';

/* ------------------------------------------------------------------ */
/* 进度辅助                                                            */
/* ------------------------------------------------------------------ */

/** 章节完成进度：答过的题 + 标记已掌握的主观题 */
function chapterProgress(chapterId) {
  const done = new Set();
  for (const s of store.getSessions()) {
    if (s.chapterId !== chapterId) continue;
    for (const d of s.detail || []) done.add(d.questionId);
  }
  for (const id of store.getMasteredIds()) {
    const q = getQuestion(id);
    if (q && q.chapterId === chapterId) done.add(id);
  }
  const total = chapterStats(chapterId).total;
  return { done: Math.min(done.size, total), total, percent: percent(done.size, total) };
}

/** 科目整体进度 */
function subjectProgress(subjectId) {
  const ids = chapterIdsOfSubject(subjectId);
  let done = 0;
  let total = 0;
  for (const id of ids) {
    const p = chapterProgress(id);
    done += p.done;
    total += p.total;
  }
  return { done, total, percent: percent(done, total) };
}

/** 取章节元信息；题库里没有的章节返回 null（不显示） */
function chapterMeta(chapterId) {
  const chapter = CHAPTERS.find((c) => c.id === chapterId);
  if (!chapter) return null;
  const st = chapterStats(chapterId);
  if (!st.total) return null;
  return { ...chapter, ...chapterProgress(chapterId), ...st };
}

/* ------------------------------------------------------------------ */
/* 板块入口                                                            */
/* ------------------------------------------------------------------ */

export function SubjectsView() {
  const subjectCards = SUBJECTS.map((subject) => {
    const p = subjectProgress(subject.id);
    const chapterCount = chapterIdsOfSubject(subject.id).filter((id) => chapterStats(id).total > 0).length;
    return h(
      'button.mode-card.subject-card',
      { type: 'button', onclick: () => go(`subject/${subject.id}`) },
      [
        h('span.mode-card__icon.subject-card__icon', { text: subject.icon }),
        h('span.mode-card__title', { text: subject.name }),
        h('span.mode-card__desc', { text: subject.desc }),
        h('div.subject-card__meta', null, [
          tag(`${p.total} 题`, 'primary'),
          tag(`${chapterCount} 个章节`),
        ]),
        progressBar(p.percent),
        h('span.subject-card__progress', { text: `已练 ${p.done}/${p.total}` }),
      ]
    );
  });

  const strategyEntry = h('button.list__item', { type: 'button', onclick: () => go('strategy') }, [
    h('div.chapter-row__icon', { text: '🎯' }),
    h('div.list__main', null, [
      h('div.list__title', { text: '答题技巧与策略' }),
      h('div.list__sub', { text: `${STRATEGY_TOPICS.length} 篇讲解：分题型作答法、作文句型、考场规范` }),
    ]),
    h('span.list__arrow', { text: '›' }),
  ]);

  const body = h('div.page__body', null, [
    h('div.mode-grid.mode-grid--single', null, subjectCards),
    h('section.section', null, [
      h('div.section__head', null, [h('h2.section__title', { text: '内容讲解' })]),
      h('div.list', null, [strategyEntry]),
    ]),
  ]);

  return h('div.page', null, [
    header({ title: '选择板块', onBack: () => go('home') }),
    body,
    tabbar('subjects'),
  ]);
}

/* ------------------------------------------------------------------ */
/* 科目详情                                                            */
/* ------------------------------------------------------------------ */

export function SubjectView({ id }) {
  const subject = getSubject(id);
  if (!subject) {
    return h('div.page', null, [
      header({ title: '板块不存在', onBack: () => go('subjects') }),
      h('div.page__body', null, emptyState('🧭', '没有找到这个板块')),
    ]);
  }

  const p = subjectProgress(subject.id);

  const groups = subject.groups
    .map((group) => {
      const chapters = group.chapters.map(chapterMeta).filter(Boolean);
      if (!chapters.length) return null;

      const groupTotal = chapters.reduce((a, c) => a + c.total, 0);
      const groupDone = chapters.reduce((a, c) => a + c.done, 0);

      return h('section.section', null, [
        h('div.section__head', null, [
          h('div', null, [
            h('h2.section__title', { text: group.name }),
            group.desc ? h('div.list__sub', { text: group.desc }) : null,
          ]),
          h('span.tag', { text: `${groupDone}/${groupTotal}` }),
        ]),
        h(
          'div.list',
          null,
          chapters.map((chapter) =>
            h('button.list__item', { type: 'button', onclick: () => go(`chapter/${chapter.id}`) }, [
              h('div.chapter-row__icon', { text: chapter.icon }),
              h('div.list__main', null, [
                h('div.list__title', { text: chapter.name }),
                h('div.list__sub', {
                  text: `${chapter.total} 题 · 简单 ${chapter.easy} / 中等 ${chapter.medium} / 困难 ${chapter.hard}`,
                }),
                progressBar(chapter.percent),
                h('div.list__sub', { text: `已练 ${chapter.done}/${chapter.total}` }),
              ]),
              h('span.list__arrow', { text: '›' }),
            ])
          )
        ),
      ]);
    })
    .filter(Boolean);

  const body = h('div.page__body', null, [
    h('div.card', null, [
      h('div.flex-between', null, [
        h('div', null, [
          h('div.list__title', { text: `${subject.icon} ${subject.name}` }),
          h('div.list__sub', { text: subject.desc }),
        ]),
        h('span.tag.tag--primary', { text: `${p.total} 题` }),
      ]),
      progressBar(p.percent),
      h('div.list__sub.mt-8', { text: `整体进度 ${p.done}/${p.total}` }),
      h('div.btn-row.mt-12', null, [
        h('button.btn.btn--sm.btn--outline', {
          type: 'button',
          text: '随机组卷练习',
          onclick: () => go(`setup/practice?subject=${subject.id}`),
        }),
        h('button.btn.btn--sm.btn--primary', {
          type: 'button',
          text: '模拟考试',
          onclick: () => go(`setup/exam?subject=${subject.id}`),
        }),
      ]),
    ]),
    ...groups,
  ]);

  return h('div.page', null, [
    header({ title: subject.name, onBack: () => go('subjects') }),
    body,
    tabbar('subjects'),
  ]);
}

/* ------------------------------------------------------------------ */
/* 答题技巧板块                                                        */
/* ------------------------------------------------------------------ */

export function StrategyView() {
  const sections = STRATEGY_SUBJECTS.map((sub) => {
    const topics = topicsOfSubject(sub.id);
    if (!topics.length) return null;
    return h('section.section', null, [
      h('div.section__head', null, [
        h('div', null, [
          h('h2.section__title', { text: `${sub.icon} ${sub.name}` }),
          h('div.list__sub', { text: sub.desc }),
        ]),
      ]),
      h(
        'div.list',
        null,
        topics.map((topic) =>
          h('button.list__item', { type: 'button', onclick: () => go(`strategy/${topic.id}`) }, [
            h('div.list__main', null, [
              h('div.list__title', { text: topic.title }),
              h('div.list__sub', { text: topic.summary }),
            ]),
            h('span.list__arrow', { text: '›' }),
          ])
        )
      ),
    ]);
  }).filter(Boolean);

  const body = h('div.page__body', null, [
    h('div.card.card--flat', null, [
      h('div.list__title', { text: '怎么用这一板块' }),
      h('p.text-sm.text-muted.mt-8', {
        text: '这里放的是答题方法与考场策略，属于经验性技巧，不是必背知识点。建议在考前完整过一遍，尤其是分题型作答法、作文万能句型和考场规范。',
      }),
    ]),
    ...sections,
  ]);

  return h('div.page', null, [
    header({ title: '答题技巧与策略', onBack: () => go('home') }),
    body,
    tabbar('subjects'),
  ]);
}

/* ------------------------------------------------------------------ */
/* 技巧条目详情                                                        */
/* ------------------------------------------------------------------ */

/** 渲染一个内容块 */
function renderBlock(block) {
  switch (block.type) {
    case 'h':
      return h('h3.strategy-h', { text: block.text });
    case 'list':
      return h(
        'ul.strategy-list',
        null,
        (block.items || []).map((item) => h('li.strategy-list__item', { text: item }))
      );
    case 'table':
      return h('div.strategy-table-wrap', null, [
        h(
          'table.strategy-table',
          null,
          [
            h('thead', null, [
              h('tr', null, block.head.map((th) => h('th', { text: th }))),
            ]),
            h(
              'tbody',
              null,
              block.rows.map((row) => h('tr', null, row.map((td) => h('td', { text: td }))))
            ),
          ]
        ),
      ]);
    case 'tip':
      return h(`div.strategy-tip.strategy-tip--${block.tone || 'good'}`, null, [
        h('span.strategy-tip__icon', { text: block.tone === 'warn' ? '⚠️' : '💡' }),
        h('span', { text: block.text }),
      ]);
    default:
      return h('p.strategy-p', { text: block.text });
  }
}

export function StrategyTopicView({ id }) {
  const topic = getStrategyTopic(id);
  if (!topic) {
    return h('div.page', null, [
      header({ title: '内容不存在', onBack: () => go('strategy') }),
      h('div.page__body', null, emptyState('🔍', '没有找到这篇内容')),
    ]);
  }

  const sub = getStrategySubject(topic.subject);
  const siblings = topicsOfSubject(topic.subject);
  const idx = siblings.findIndex((t) => t.id === topic.id);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  const body = h('div.page__body', null, [
    h('div.strategy-head', null, [
      h('div.tag-row', null, [
        tag(`${sub ? sub.icon + ' ' + sub.name : '答题技巧'}`, 'primary'),
        tag(`第 ${idx + 1}/${siblings.length} 篇`),
      ]),
      h('h1.strategy-title', { text: topic.title }),
      h('p.strategy-summary', { text: topic.summary }),
    ]),
    h('div.strategy-body', null, (topic.blocks || []).map(renderBlock)),
    h('div.mt-20', null, [
      h('button.btn.btn--sm.btn--outline.btn--block', {
        type: 'button',
        text: '返回技巧目录',
        onclick: () => go('strategy'),
      }),
    ]),
  ]);

  const footer = h('div.footer-bar', null, [
    h('button.btn.btn--ghost', {
      type: 'button',
      text: prev ? '上一篇' : '已是第一篇',
      disabled: !prev,
      onclick: () => prev && go(`strategy/${prev.id}`),
    }),
    h('button.btn.btn--primary', {
      type: 'button',
      text: next ? '下一篇' : '看完了，去刷题',
      onclick: () => (next ? go(`strategy/${next.id}`) : go('subjects')),
    }),
  ]);

  return h('div.page', null, [
    header({ title: '答题技巧', onBack: () => go('strategy') }),
    body,
    footer,
  ]);
}

export { engine, toast };
