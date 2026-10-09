/**
 * 修复 CSV 列数错位：为「判断题但漏写选项列」的行补上 4 个空选项列。
 *
 *   node tools/fix-csv-columns.mjs work/成考题库-英语与策略.csv
 *
 * 背景：模板有 14 列（… optionE, answer, answerText, analysis, tags）。
 * 判断题不需要选项，手写时容易把 answer 直接写到 optionE 的位置，
 * 导致该行少 4 个字段、后面所有字段整体左移。
 */

import fs from 'node:fs';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('用法: node tools/fix-csv-columns.mjs <csv文件>');
  process.exit(1);
}

function splitCsvLine(line) {
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
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function csvCell(v) {
  const t = v == null ? '' : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
const header = splitCsvLine(lines[0]);
const expected = header.length;

const ANSWER_KINDS = new Set(['判断', '判断题', 'judge', 'tf']);

let fixed = 0;
const out = [header.map(csvCell).join(',')];

for (const line of lines.slice(1)) {
  const cells = splitCsvLine(line);
  if (cells.length === expected) {
    out.push(cells.map(csvCell).join(','));
    continue;
  }

  // 判断题不需要选项列，手写时常常整段跳过 optionA~optionE（甚至也跳过空的 answerText），
  // 于是该行比表头少 4 或 5 个字段。这里把缺的字段补成空值。
  const missing = expected - cells.length;
  const typeIdx = header.findIndex((h) => /^type$/i.test(h) || h === '题型');
  const isJudgeLike = ANSWER_KINDS.has(String(cells[typeIdx] || '').trim());

  if (isJudgeLike && (missing === 4 || missing === 5)) {
    // 缺列字段都是「选项列 + answerText」，它们在表头里都位于 stem 之后、analysis 之前。
    // 因此直接在 stem 之后补空值即可，不必推算 answer 的位置。
    const stemIdx = header.findIndex((h) => /^stem$/i.test(h));
    const insertAt = stemIdx >= 0 ? stemIdx + 1 : 4;
    const patched = [
      ...cells.slice(0, insertAt),
      ...Array(missing).fill(''),
      ...cells.slice(insertAt),
    ];
    out.push(patched.map(csvCell).join(','));
    fixed += 1;
    continue;
  }

  console.warn(`  ! 第 ${out.length + 1} 行列数异常（${cells.length}/${expected}），已原样保留：${cells[0]}`);
  console.warn(`      字段: ${cells.map((c, i) => `${i}:${String(c).slice(0, 12)}`).join(' | ')}`);
  out.push(cells.map(csvCell).join(','));
}

fs.writeFileSync(file, `\uFEFF${out.join('\r\n')}\r\n`, 'utf8');
console.log(`\n  已修复 ${fixed} 行（补齐 4 个空选项列）`);
console.log(`  输出: ${file}\n`);
