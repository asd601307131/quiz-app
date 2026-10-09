/**
 * 解析「陕西成考专升本政治」历年真题原始文本，生成题库 CSV。
 *
 *   node scripts/parse-real-exams.mjs
 *
 * 输入: work/raw/*政治真题.txt
 * 输出: work/成考题库-真题.csv、work/真题章节.csv、work/parse-report-real.txt
 *
 * 支持两种原文格式：
 *   2024 版：1.题干(A)      ← 答案在题干末尾括号里
 *   2023 版：1.题干（ A ）   ← 答案在题干末尾括号里（含空格）
 *   主观题：36.题干 + 【参考答案】/答案：
 *
 * 说明：只收录「题干 + 4 个选项 + 答案」都完整的题；答案字母对应的选项缺失时跳过并记入报告，
 *      不做任何猜测或编造。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'work', 'raw');
const OUT_CSV = path.join(ROOT, 'work', '成考题库-真题.csv');
const OUT_CHAPTERS = path.join(ROOT, 'work', '真题章节.csv');
const OUT_REPORT = path.join(ROOT, 'work', 'parse-report-real.txt');

if (!fs.existsSync(RAW_DIR)) {
  console.error(`找不到原始素材目录: ${RAW_DIR}`);
  process.exit(1);
}

const files = fs
  .readdirSync(RAW_DIR)
  .filter((f) => f.endsWith('.txt') && f.includes('政治真题'))
  .sort();

if (!files.length) {
  console.error('work/raw 下没有找到 *政治真题.txt');
  process.exit(1);
}

const report = [];
const records = [];

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const OPTION_LINE = /^([A-Da-d])\s*[.．、)）]\s*(.+)$/;
const NUM_LINE = /^(\d{1,2})\s*[.．、]\s*(.*)$/;
const ANSWER_TAIL = /[（(]\s*([A-Da-d])\s*[）)]\s*$/;
/** 题干里带「（ ）」但没写答案的（属于缺答案，跳过） */
const BLANK_TAIL = /[（(]\s*[）)]\s*$/;

const SUBJECTIVE_MARKERS = /【参考答案】|答案：|答案:|参考答案/;

const SECTION_CHAPTER = [
  { test: /一[、.]\s*选择题/, id: 'real-2024-choice' },
  { test: /二[、.]\s*简答题/, id: 'real-2024-short' },
  { test: /三[、.]\s*论述题/, id: 'real-2024-essay' },
];

const oneLine = (t) =>
  String(t || '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

/* ------------------------------------------------------------------ */
/* 按文件解析                                                          */
/* ------------------------------------------------------------------ */

for (const file of files) {
  const yearMatch = /(\d{4})/.exec(file);
  const year = yearMatch ? yearMatch[1] : 'unknown';
  const raw = fs.readFileSync(path.join(RAW_DIR, file), 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).map((l) => l.trim());

  // 跳过头部元信息（来源/抓取时间/说明）
  const startAt = lines.findIndex((l) => /^[一二三][、.]\s*(选择题|简答题|论述题)/.test(l));
  const body = lines.slice(startAt < 0 ? 0 : startAt);

  let section = 'choice';
  let cur = null;
  const items = [];

  const flush = () => {
    if (cur) items.push(cur);
    cur = null;
  };

  for (const line of body) {
    if (!line) continue;

    if (/^[一二三][、.]\s*选择题/.test(line)) { flush(); section = 'choice'; continue; }
    if (/^[一二三][、.]\s*简答题/.test(line)) { flush(); section = 'short'; continue; }
    if (/^[一二三][、.]\s*论述题/.test(line)) { flush(); section = 'essay'; continue; }
    if (/^来源:|^抓取时间:|^说明:/.test(line)) continue;

    const m = NUM_LINE.exec(line);
    if (m) {
      flush();
      cur = { no: Number(m[1]), section, parts: [m[2]], options: [] };
      continue;
    }

    if (!cur) continue;

    const om = OPTION_LINE.exec(line);
    // 选项行：仅当当前题的选项还没满 4 个、且字母顺序吻合时才算选项
    if (om && cur.section === 'choice' && cur.options.length < 4 && om[1].toUpperCase() === 'ABCD'[cur.options.length]) {
      cur.options.push(oneLine(om[2]));
      continue;
    }

    // 【参考答案】之后的内容都算答案
    cur.parts.push(line);
  }
  flush();

  /* ---- 组装记录 ---- */
  for (const it of items) {
    const first = oneLine(it.parts[0] || '');
    const restParts = it.parts.slice(1);

    if (it.section === 'choice') {
      // 2023 版选项可能和题干同行，或答案括号在题干行
      const ansMatch = ANSWER_TAIL.exec(first);
      let stem = first;
      let answer = ansMatch ? ansMatch[1].toUpperCase() : null;

      if (!answer) {
        // 答案可能单独成行写在选项之后（少数情况）
        const inlineAns = restParts.find((p) => /^[（(]\s*[A-Da-d]\s*[）)]$/.test(p));
        if (inlineAns) answer = /[A-Da-d]/.exec(inlineAns)[0].toUpperCase();
      }

      stem = oneLine(stem.replace(ANSWER_TAIL, '').replace(BLANK_TAIL, ''));

      if (!answer) {
        report.push(`[${year}] 第 ${it.no} 题没有答案，跳过：${stem.slice(0, 40)}`);
        continue;
      }
      if (it.options.length < 4) {
        report.push(`[${year}] 第 ${it.no} 题只有 ${it.options.length} 个选项，跳过：${stem.slice(0, 40)}`);
        continue;
      }
      const idx = answer.charCodeAt(0) - 65;
      if (idx < 0 || idx > 3) {
        report.push(`[${year}] 第 ${it.no} 题答案 ${answer} 超出范围，跳过`);
        continue;
      }

      records.push({
        year,
        no: it.no,
        section: 'choice',
        stem,
        options: it.options,
        answer,
        analysis: `正确答案 ${answer}：${it.options[idx]}`,
      });
      continue;
    }

    // 主观题
    const answerStart = it.parts.findIndex((p) => SUBJECTIVE_MARKERS.test(p));
    const stem = oneLine(first);
    let answerText = '';

    if (answerStart >= 0) {
      const sameLine = oneLine(it.parts[answerStart].replace(SUBJECTIVE_MARKERS, ''));
      const following = it.parts.slice(answerStart + 1);
      answerText = oneLine([sameLine, ...following].filter(Boolean).join(' '));
    } else {
      // 答案没有标记，取题干之后的所有内容
      answerText = oneLine(restParts.join(' '));
    }

    if (!answerText) {
      report.push(`[${year}] 第 ${it.no} 题（主观题）没有参考答案，跳过：${stem.slice(0, 40)}`);
      continue;
    }

    records.push({
      year,
      no: it.no,
      section: it.section === 'essay' ? 'essay' : 'short',
      stem,
      answerText,
      analysis: it.section === 'essay' ? '论述题：先摆原理，再联系实际，最后归纳总结。' : '简答题：按要点作答，踩点给分。',
    });
  }

  report.push(`[${year}] 文件 ${file}：解析出 ${items.length} 个题号`);
}

/* ------------------------------------------------------------------ */
/* 去重 + 输出                                                         */
/* ------------------------------------------------------------------ */

const seen = new Set();
const unique = [];
for (const r of records) {
  const key = r.stem.replace(/\s/g, '');
  if (seen.has(key)) {
    report.push(`重复题目已去重（${r.year} 第 ${r.no} 题）：${r.stem.slice(0, 30)}`);
    continue;
  }
  seen.add(key);
  unique.push(r);
}

const chapterOf = (r) => {
  if (r.section === 'choice') return `real-${r.year}-choice`;
  if (r.section === 'essay') return `real-${r.year}-essay`;
  return `real-${r.year}-short`;
};

const chapterMeta = {
  'real-2024-choice': { name: '2024年真题·选择题', desc: '2024 年成人高考专升本政治选择题（20 题，每题 2 分）', icon: '🗓️' },
  'real-2024-short': { name: '2024年真题·简答题', desc: '2024 年简答题（4 题，每题 10 分）', icon: '✍️' },
  'real-2024-essay': { name: '2024年真题·论述题', desc: '2024 年论述题（2 题，每题 20 分）', icon: '📝' },
  'real-2023-choice': { name: '2023年真题·选择题', desc: '2023 年成人高考专升本政治选择题', icon: '🗓️' },
  'real-2023-short': { name: '2023年真题·简答题', desc: '2023 年简答题（4 题，每题 10 分）', icon: '✍️' },
  'real-2023-essay': { name: '2023年真题·论述题', desc: '2023 年论述题（2 题，每题 20 分）', icon: '📝' },
};

const counter = new Map();
unique.forEach((r) => {
  const ch = chapterOf(r);
  const n = (counter.get(ch) || 0) + 1;
  counter.set(ch, n);
  r.chapterId = ch;
  r.id = `${ch}-${String(n).padStart(3, '0')}`;
  r.difficulty = r.section === 'choice' ? (r.no <= 8 ? 'easy' : r.no <= 15 ? 'medium' : 'hard') : 'hard';
});

/* ---- CSV ---- */

function csvCell(v) {
  const t = v == null ? '' : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const HEADERS = ['id', 'chapterId', 'difficulty', 'type', 'stem', 'optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'answer', 'answerText', 'analysis', 'tags'];

const rows = unique.map((r) => {
  const opts = r.options || [];
  const row = {
    id: r.id,
    chapterId: r.chapterId,
    difficulty: r.difficulty,
    type: r.section === 'choice' ? '单选' : '简答',
    stem: oneLine(r.stem),
    optionA: oneLine(opts[0] || ''),
    optionB: oneLine(opts[1] || ''),
    optionC: oneLine(opts[2] || ''),
    optionD: oneLine(opts[3] || ''),
    optionE: '',
    answer: r.answer || '',
    answerText: oneLine(r.answerText || ''),
    analysis: oneLine(r.analysis || ''),
    tags: `${r.year}真题`,
  };
  return HEADERS.map((h) => csvCell(row[h])).join(',');
});

fs.writeFileSync(OUT_CSV, `\uFEFF${HEADERS.join(',')}\r\n${rows.join('\r\n')}\r\n`, 'utf8');

const usedChapters = [...counter.keys()].sort().reverse();
fs.writeFileSync(
  OUT_CHAPTERS,
  `\uFEFF${['id,name,desc,icon'].join(',')}\r\n${usedChapters
    .map((id) => [id, chapterMeta[id].name, chapterMeta[id].desc, chapterMeta[id].icon].map(csvCell).join(','))
    .join('\r\n')}\r\n`,
  'utf8'
);

const choiceCount = unique.filter((r) => r.section === 'choice').length;
const shortCount = unique.filter((r) => r.section === 'short').length;
const essayCount = unique.filter((r) => r.section === 'essay').length;

fs.writeFileSync(
  OUT_REPORT,
  [
    `输入: ${files.join(', ')}`,
    `抽取时间: ${new Date().toLocaleString('zh-CN')}`,
    '',
    `收录 ${unique.length} 题（选择 ${choiceCount} / 简答 ${shortCount} / 论述 ${essayCount}）`,
    '章节分布:',
    ...[...counter.entries()].map(([id, n]) => `  ${id.padEnd(20)} ${String(n).padStart(3)} 题  ${chapterMeta[id].name}`),
    '',
    `跳过/提醒 ${report.length} 条:`,
    ...report.map((r) => `  - ${r}`),
    '',
  ].join('\n'),
  'utf8'
);

console.log(`\n  真题抽取完成`);
console.log(`    选择 ${choiceCount} / 简答 ${shortCount} / 论述 ${essayCount}，共 ${unique.length} 题`);
console.log(`    CSV:  ${path.relative(ROOT, OUT_CSV)}`);
console.log(`    章节: ${path.relative(ROOT, OUT_CHAPTERS)}`);
console.log(`    报告: ${path.relative(ROOT, OUT_REPORT)}（跳过 ${report.length} 条）\n`);
