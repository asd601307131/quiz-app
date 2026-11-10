/**
 * 科目 → 章节的两级归档。
 *
 * 首页只展示这里定义的科目；点进科目后再按分组展示章节。
 * 章节 id 必须与题库（src/data/questions.js）里的 chapterId 一致，
 * 否则该章节不会出现在任何科目下。
 *
 * 当前题库：电工技能等级认定复习资料（361 题 / 5 章节）
 */

export const SUBJECTS = [
  {
    id: 'electrician',
    name: '电工技能等级认定',
    icon: '⚡',
    desc: '理论基础 + 电气安全 + 自动化控制，练熟即可上考场',
    groups: [
      {
        name: '职业素养（基础必得分）',
        desc: '职业道德、职业纪律、企业文化、质量管理与班组管理',
        chapters: ['elec-ethics'],
      },
      {
        name: '理论基础（分值最大）',
        desc: '电路基础、交直流电路、磁与电磁、电子技术基础',
        chapters: ['elec-basic'],
      },
      {
        name: '电机与变压器',
        desc: '电动机、变压器、发电机、控制电机及其检修',
        chapters: ['elec-machine'],
      },
      {
        name: '自动化与控制',
        desc: 'PLC、变频器、传感器、伺服与步进、自动控制系统',
        chapters: ['elec-auto'],
      },
      {
        name: '电气安全（必拿分）',
        desc: '安全规程、触电急救、接地接零、防雷与绝缘',
        chapters: ['elec-safety'],
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
