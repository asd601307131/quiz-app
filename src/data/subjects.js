/**
 * 科目 → 章节的两级归档。
 *
 * 首页只展示这里定义的科目；点进科目后再按分组展示章节。
 * 章节 id 必须与题库（src/data/questions.js）里的 chapterId 一致，
 * 否则该章节不会出现在任何科目下。
 */

export const SUBJECTS = [
  {
    id: 'politics',
    name: '政治',
    icon: '📕',
    desc: '选择题 70 分 + 主观题 80 分，拿分主力',
    groups: [
      {
        name: '第一部分 马克思主义哲学原理',
        desc: '哲学基本问题、物质与意识、辩证法、认识论、唯物史观',
        chapters: ['p1-1', 'p1-2', 'p1-3', 'p1-4', 'p1-5', 'p1-6'],
      },
      {
        name: '第二部分 毛泽东思想和中国特色社会主义理论体系',
        desc: '毛泽东思想、新民主主义革命、社会主义改造、中特理论体系',
        chapters: ['p2-1', 'p2-2', 'p2-3', 'p2-4', 'p2-5', 'p2-6', 'p2-7', 'p2-8', 'p2-9', 'p2-10', 'p2-11'],
      },
      {
        name: '主观题专项',
        desc: '辨析题（判断正误 + 说明理由）、简答与论述',
        chapters: ['subj-bx', 'subj-jd'],
      },
      {
        name: '陕西历年真题',
        desc: '2023、2024 年真题，按题型分开练',
        chapters: ['real-2024-choice', 'real-2024-short', 'real-2024-essay', 'real-2023-choice', 'real-2023-short', 'real-2023-essay'],
      },
    ],
  },
  {
    id: 'english',
    name: '英语',
    icon: '🔤',
    desc: '选择题 125 分 + 书面表达 25 分，靠技巧与句型提分',
    groups: [
      {
        name: '题型与考情',
        desc: '先搞清考什么、多少分，再决定怎么复习',
        chapters: ['en-format'],
      },
      {
        name: '语音·词汇·语法',
        desc: '语音 5 分 + 词汇语法 15 分的高频考点',
        chapters: ['en-grammar'],
      },
    ],
  },
];

/** 按 id 取科目 */
export function getSubject(id) {
  return SUBJECTS.find((s) => s.id === id) || null;
}

/**
 * 判断某个章节属于哪些科目。
 * 用于根据题库里实际存在的 chapterId 反查归属。
 */
export function subjectOfChapter(chapterId) {
  for (const subject of SUBJECTS) {
    for (const group of subject.groups) {
      if (group.chapters.includes(chapterId)) return subject.id;
    }
  }
  return null;
}

/** 展开某个科目的全部章节 id */
export function chapterIdsOfSubject(subjectId) {
  const subject = getSubject(subjectId);
  if (!subject) return [];
  return subject.groups.flatMap((g) => g.chapters);
}
