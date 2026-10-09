/**
 * 主观题精确解析：按《题型及考情分析》中四个小节的固定结构抽取题干与参考答案。
 *
 *   node scripts/parse-subjective.mjs
 *
 * 输出：
 *   work/成考题库-主观题.csv     辨析题 A/B、简答题、论述题（题干与答案严格配对）
 *   work/parse-subjective-report.txt
 *
 * 为什么要单独写这个脚本：
 *   通用块解析（parse-politics.mjs）按「【历年真题】…【答案】…」顺序配对，
 *   但这四个小节里存在两类陷阱：
 *     1) 辨析题块 A 的答案只有「1.错误。(2分)」，没有理由；
 *        紧随其后的「1.社会主义本质理论的科学内涵…」其实是简答题答案，
 *        位置相邻导致错配（历史事故：subj-jd-001/002 配到了不相干的答案）。
 *     2) 辨析题块 B 有 7 道题但只有 5 个答案，多出的两道必须丢弃而不是顺延。
 *   因此这里改为**按行号区间精确切分**，并在生成时做配对校验。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPoints, shouldExtractPoints } from '../src/core/points.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'work', 'pdf-text', '专升本_理工类_题型及考情分析.txt');
const OUT_CSV = path.join(ROOT, 'work', '成考题库-主观题.csv');
const OUT_REPORT = path.join(ROOT, 'work', 'parse-subjective-report.txt');

const CORPUS = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);

/** PDF 页眉页脚噪声 */
const NOISE = /^(政治、英语、高等数学|内部资料，禁止印刷销售|={3,}|第\s*\d+\s*页|\d{1,3})$/;

/** 行内混入的页脚文字（有时与正文连在同一行，需要清除而不是整行丢弃） */
const INLINE_NOISE = /内部资料[，,]?\s*禁止印刷销售[！!]?/g;

/** 取行号区间（1-based，含首尾），并清理噪声行 */
function slice(from, to) {
  return CORPUS.slice(from - 1, to)
    .map((l) => l.trim().replace(INLINE_NOISE, '').trim())
    .filter((l) => l && !NOISE.test(l) && !/^=====/.test(l));
}

/**
 * 把「1.xxx 2.yyy 3.zzz」形式的多行文本切成 { no, text }。
 * 只认行首的阿拉伯数字编号，避免把「2020年」「(1)」等误判为题目编号。
 */
function splitNumbered(lines) {
  const items = [];
  let cur = null;
  for (const line of lines) {
    const m = /^(\d{1,2})\s*[.．、]\s*(.*)$/.exec(line);
    if (m) {
      if (cur) items.push(cur);
      cur = { no: Number(m[1]), text: m[2].trim() };
    } else if (cur) {
      cur.text += line;
    }
  }
  if (cur) items.push(cur);
  return items;
}

/** 把「N.解析 …」形式的答案切成 { no, text }（"解析" 可有可无） */
function splitAnswers(lines) {
  const items = [];
  let cur = null;
  for (const line of lines) {
    const m = /^(\d{1,2})\s*[.．、]\s*(?:解析|答案)?\s*(.*)$/.exec(line);
    const isAnswerHead = m && (/(解析|答案)/.test(line) || /^(错误|正确|不对|对)(?![\u4e00-\u9fa5])/.test(m[2]));
    if (isAnswerHead) {
      if (cur) items.push(cur);
      cur = { no: Number(m[1]), text: m[2].trim() };
    } else if (cur) {
      cur.text += line;
    }
  }
  if (cur) items.push(cur);
  return items;
}

/** 去掉解析里残留的分值标注，如「(2分)」「（4分）」 */
const stripScore = (t) => t.replace(/[（(]\s*\d+\s*分\s*[)）]/g, '').trim();

/** 判断题型的「判断正误」答案 */
function judgeOf(text) {
  const t = text.replace(/^[\s。．.,，、]*/, '');
  if (/^正确|^对\b|^这种说法正确/.test(t)) return { isRight: true, reason: t.replace(/^(正确|对|这种说法正确)[。．.,，、]?/, '') };
  if (/^错误|^不对|^这种说法错误/.test(t)) return { isRight: false, reason: t.replace(/^(错误|不对|这种说法错误)[。．.,、]?/, '') };
  return null;
}

const clean = (s) => s
  .replace(INLINE_NOISE, '')
  .replace(/\s+/g, ' ')
  .replace(/[。．]\s*$/, '')
  .trim();

const records = [];
const report = [];

function pushShort({ chapterId, stem, answerText, analysis, source, tag }) {
  if (!stem || stem.length < 6) {
    report.push(`跳过：题干过短「${stem}」`);
    return false;
  }
  const text = clean(answerText);
  if (!text || text.length < 8) {
    report.push(`跳过：参考答案为空/过短（${source}）题干：${stem.slice(0, 30)}`);
    return false;
  }
  const rec = {
    chapterId,
    type: 'short',
    stem: clean(stem),
    answerText: text,
    analysis,
    source,
    tags: tag,
  };
  records.push(rec);
  return true;
}

/* ================================================================== */
/* 1) 辨析题块 A（行 2116~2167）：5 题，答案 2128~2162（含完整理由）      */
/* ================================================================== */
const bxAQs = splitNumbered(slice(2117, 2126));
const bxAAs = splitAnswers(slice(2128, 2163));

bxAQs.forEach((q) => {
  const a = bxAAs.find((x) => x.no === q.no);
  if (!a) {
    report.push(`辨析题A 第 ${q.no} 题无答案，跳过：${q.text.slice(0, 30)}`);
    return;
  }
  const j = judgeOf(stripScore(a.text));
  if (!j) {
    report.push(`辨析题A 第 ${q.no} 题答案无法识别正误，跳过：「${a.text.slice(0, 30)}」`);
    return;
  }
  // 判断题：先判正误
  records.push({
    chapterId: 'subj-bx',
    type: 'judge',
    stem: `【辨析】${clean(q.text)}`,
    answer: j.isRight ? 'A' : 'B',
    analysis: `参考答案：该说法${j.isRight ? '正确' : '错误'}。作答要求：先明确判断正误。`,
    source: '辨析题A',
    tags: '辨析题,判断正误',
  });
  // 简答：说明理由（源文件给了理由就用原文，没有则如实标注）
  records.push({
    chapterId: 'subj-bx',
    type: 'short',
    stem: clean(`【辨析理由】${q.text} 请说明理由：该说法为什么${j.isRight ? '正确' : '错误'}？`),
    answerText: j.reason.replace(/^理由[:：]?/, '').trim().length > 10
      ? clean(j.reason.replace(/^理由[:：]?/, ''))
      : `原题给出判断为「${j.isRight ? '正确' : '错误'}」，源文件未提供详细理由，可参考对应考点自行组织。`,
    analysis: '踩点给分：先明确判断正误，再分点说明理由。',
    source: '辨析题A',
    tags: '辨析题,说明理由',
  });
});

/* ================================================================== */
/* 2) 辨析题块 B（行 2184~2268）：7 题，但只有 5 个答案                  */
/* ================================================================== */
const bxBQs = splitNumbered(slice(2185, 2196));
const bxBAs = splitAnswers(slice(2204, 2240));

bxBQs.forEach((q) => {
  const a = bxBAs.find((x) => x.no === q.no);
  if (!a) {
    report.push(`辨析题B 第 ${q.no} 题源文件未提供答案，整题丢弃：${q.text.slice(0, 34)}`);
    return;
  }
  const j = judgeOf(stripScore(a.text));
  if (!j) {
    report.push(`辨析题B 第 ${q.no} 题答案无法识别正误，丢弃：「${a.text.slice(0, 30)}」`);
    return;
  }
  records.push({
    chapterId: 'subj-bx',
    type: 'judge',
    stem: `【辨析】${clean(q.text)}`,
    answer: j.isRight ? 'A' : 'B',
    analysis: `参考答案：该说法${j.isRight ? '正确' : '错误'}。作答要求：先明确判断正误。`,
    source: '辨析题B',
    tags: '辨析题,判断正误',
  });
  if (j.reason && j.reason.replace(/^理由[:：]?/, '').trim().length > 10) {
    records.push({
      chapterId: 'subj-bx',
      type: 'short',
      stem: clean(`【辨析理由】${q.text} 请说明理由：该说法为什么${j.isRight ? '正确' : '错误'}？`),
      answerText: clean(j.reason.replace(/^理由[:：]?/, '')),
      analysis: '踩点给分：先明确判断正误，再分点说明理由。',
      source: '辨析题B',
      tags: '辨析题,说明理由',
    });
  }
});

/* ================================================================== */
/* 3) 简答题（题目 2275~2306，答案 2313~2460）                          */
/* ================================================================== */
const shortQs = splitNumbered(slice(2275, 2306));
const shortAs = splitAnswers(slice(2313, 2461));

shortQs.forEach((q) => {
  const a = shortAs.find((x) => x.no === q.no);
  if (!a) {
    report.push(`简答题 第 ${q.no} 题无答案，跳过：${q.text.slice(0, 30)}`);
    return;
  }
  // 配对校验：题干与答案必须有关联，否则宁可丢弃
  pushShort({
    chapterId: 'subj-jd',
    stem: q.text,
    answerText: a.text,
    analysis: '按要点作答，踩点给分。',
    source: `简答题 第${q.no}题`,
    tag: '简答题',
  });
});

/* ================================================================== */
/* 4) 论述题（题目 2485~2501，答案 2509~2578）                          */
/* ================================================================== */
const essayQs = splitNumbered(slice(2485, 2502));
const essayAs = splitAnswers(slice(2509, 2579));

essayQs.forEach((q) => {
  const a = essayAs.find((x) => x.no === q.no);
  if (!a) {
    report.push(`论述题 第 ${q.no} 题无答案，跳过：${q.text.slice(0, 30)}`);
    return;
  }
  pushShort({
    chapterId: 'subj-jd',
    stem: `【论述】${q.text}`,
    answerText: a.text,
    analysis: '论述题三段式：摆原理 → 联系实际 → 归纳总结。',
    source: `论述题 第${q.no}题`,
    tag: '论述题',
  });
});

/* ================================================================== */
/* 配对校验：题干与答案的关键词重合度                                   */
/* ================================================================== */
const STOP = new Set(['什么', '怎样', '如何', '哪些', '为什么', '简述', '论述', '说明', '主要', '基本', '重要', '的是', '可以', '以及', '一个']);
function grams(text) {
  const s = String(text || '').replace(/[【】（）()《》「」“”"'’,，。、；：？！\-—…%　\s]/g, '');
  const out = new Set();
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.slice(i, i + 2);
    if (!STOP.has(g)) out.add(g);
  }
  return out;
}

const STRATEGY_MARKERS = ['关键词捕捉题干信号', '仔细审题', '草稿纸上写下', '多角度能够提高命中率', '复述材料', '如果背住的原理文字量太少'];

const surviving = [];
for (const r of records) {
  if (r.type !== 'short') {
    surviving.push(r);
    continue;
  }
  const leaked = STRATEGY_MARKERS.filter((m) => r.answerText.includes(m));
  if (leaked.length) {
    report.push(`丢弃（参考答案实为答题技巧文字，${r.source}）：${r.stem.slice(0, 34)}`);
    continue;
  }
  const sk = grams(r.stem);
  const ak = grams(r.answerText);
  let hit = 0;
  for (const g of ak) if (sk.has(g)) hit += 1;
  const overlap = ak.size ? hit / Math.min(ak.size, sk.size) : 1;
  if (overlap < 0.06) {
    report.push(`丢弃（题干与答案无关联，重合度 ${(overlap * 100).toFixed(1)}%，${r.source}）：${r.stem.slice(0, 30)}`);
    continue;
  }
  surviving.push(r);
}

/* ================================================================== */
/* 输出 CSV                                                            */
/* ================================================================== */
const HEADER = ['id', 'chapterId', 'difficulty', 'type', 'stem', 'optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'answer', 'answerText', 'analysis', 'tags'];

const csvCell = (v) => {
  const t = v == null ? '' : String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

const rows = [HEADER.join(',')];
const counters = {};
surviving.forEach((r) => {
  const prefix = r.chapterId === 'subj-bx' ? 'bx' : 'jd';
  counters[prefix] = (counters[prefix] || 0) + 1;
  const id = `${prefix}-${String(counters[prefix]).padStart(3, '0')}`;
  const typeLabel = r.type === 'judge' ? '判断' : '简答';
  const difficulty = r.source.startsWith('辨析题') ? '中等' : r.source.startsWith('论述题') ? '困难' : '中等';
  const cells = [
    id,
    r.chapterId,
    difficulty,
    typeLabel,
    r.stem,
    '', '', '', '', '',
    r.answer || '',
    r.answerText || '',
    r.analysis || '',
    r.tags || typeLabel,
  ];
  rows.push(cells.map(csvCell).join(','));
});

fs.writeFileSync(OUT_CSV, `\uFEFF${rows.join('\r\n')}\r\n`, 'utf8');

/* ================================================================== */
/* 输出报告                                                            */
/* ================================================================== */
const byChapter = {};
surviving.forEach((r) => {
  byChapter[r.chapterId] = byChapter[r.chapterId] || { judge: 0, short: 0 };
  byChapter[r.chapterId][r.type === 'judge' ? 'judge' : 'short'] += 1;
});

const lines = [
  `源文件: ${path.relative(ROOT, SRC)}`,
  `抽取时间: ${new Date().toLocaleString('zh-CN')}`,
  '',
  `入选题数: ${surviving.length}`,
  `  subj-bx 辨析题专项: 判断 ${byChapter['subj-bx'] ? byChapter['subj-bx'].judge : 0} 题 + 说明理由 ${byChapter['subj-bx'] ? byChapter['subj-bx'].short : 0} 题`,
  `  subj-jd 简答与论述: 简答/论述 ${byChapter['subj-jd'] ? byChapter['subj-jd'].short : 0} 题`,
  '',
  `丢弃/提醒 ${report.length} 条:`,
  ...report.map((r) => `  - ${r}`),
  '',
];

fs.writeFileSync(OUT_REPORT, lines.join('\n'), 'utf8');

console.log(`\n  结构化解析完成：入选 ${surviving.length} 题`);
console.log(`    subj-bx  判断 ${byChapter['subj-bx'] ? byChapter['subj-bx'].judge : 0} / 说明理由 ${byChapter['subj-bx'] ? byChapter['subj-bx'].short : 0}`);
console.log(`    subj-jd  简答与论述 ${byChapter['subj-jd'] ? byChapter['subj-jd'].short : 0}`);
console.log(`  丢弃/提醒 ${report.length} 条（详见 ${path.relative(ROOT, OUT_REPORT)}）`);
report.slice(0, 12).forEach((r) => console.log(`    - ${r}`));
console.log(`\n  输出: ${path.relative(ROOT, OUT_CSV)}\n`);
