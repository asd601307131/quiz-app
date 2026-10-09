/**
 * 抽查题库 CSV 的抽取质量。
 *
 *   node tools/sample-bank.mjs work/成考题库-政治.csv [抽样数量]
 *
 * 用于确认从 PDF 抽出的题干、选项、答案、解析是否对应正确。
 */

import fs from 'node:fs';

const file = process.argv[2] || 'work/成考题库-政治.csv';
const count = Number(process.argv[3] || 6);

if (!fs.existsSync(file)) {
  console.error(`找不到文件: ${file}`);
  process.exit(1);
}

/** 解析一行 CSV（支持引号与逗号） */
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
const rows = text.split(/\r?\n/).filter((l) => l.trim() !== '');
const header = splitCsvLine(rows[0]);
const records = rows.slice(1).map((line) => {
  const cells = splitCsvLine(line);
  const obj = {};
  header.forEach((h, i) => {
    obj[h] = cells[i] == null ? '' : cells[i];
  });
  return obj;
});

const col = (name) => header.indexOf(name);

console.log(`\n文件: ${file}`);
console.log(`共 ${records.length} 题\n`);

// 统计
const byType = {};
const byChapter = {};
const byAnswer = {};
let noAnalysis = 0;
let shortAnalysis = 0;

for (const r of records) {
  byType[r.type] = (byType[r.type] || 0) + 1;
  byChapter[r.chapterId] = (byChapter[r.chapterId] || 0) + 1;
  if (r.type === '单选') byAnswer[r.answer] = (byAnswer[r.answer] || 0) + 1;
  if (!r.analysis || r.analysis.length < 4) noAnalysis += 1;
  else if (r.analysis.length < 15) shortAnalysis += 1;
}

console.log('题型分布:', JSON.stringify(byType));
console.log('答案分布（单选）:', JSON.stringify(byAnswer));
console.log(`解析过短或缺失: ${noAnalysis} 题；解析偏短(<15字): ${shortAnalysis} 题`);
console.log('');

// 抽样
const step = Math.max(1, Math.floor(records.length / count));
const picked = [];
for (let i = 0; i < records.length && picked.length < count; i += step) picked.push(records[i]);

console.log('=== 抽样详情 ===\n');
for (const r of picked) {
  const opts = ['A', 'B', 'C', 'D'].map((L, i) => [L, r[`option${L}`], i]);
  console.log(`[${r.id}] (${r.chapterId}) ${r.stem}`);
  for (const [L, val] of opts) {
    if (!val) continue;
    const mark = r.answer === L ? ' ←正确' : '';
    console.log(`    ${L}. ${val}${mark}`);
  }
  if (r.type === '单选' && !r.answer) console.log('    ⚠ 缺答案');
  if (r.answerText) console.log(`    参考答案: ${r.answerText.slice(0, 120)}${r.answerText.length > 120 ? '…' : ''}`);
  console.log(`    解析: ${(r.analysis || '').slice(0, 140)}${(r.analysis || '').length > 140 ? '…' : ''}`);
  console.log('');
}

void col;
