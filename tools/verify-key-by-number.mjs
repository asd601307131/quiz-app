/**
 * 按题号逐题校验外部答案：把「答案文字」与卷面选项做文本匹配，
 * 定位出该答案在卷面上的字母，并报告是否与来源字母一致。
 *
 * 适用前提：外部答案表与试卷**题号一致**（同为 1~35）。
 * 这是最可靠的锚定方式——不依赖题干改写，只看答案文字能不能对上选项。
 *
 *   node tools/verify-key-by-number.mjs <真题CSV> <答案CSV> <输出CSV>
 */

import fs from 'node:fs';

const [srcCsv, keyCsv, outCsv] = process.argv.slice(2);
if (!srcCsv || !keyCsv) {
  console.error('用法: node tools/verify-key-by-number.mjs <真题CSV> <答案CSV> [输出CSV]');
  process.exit(1);
}

function splitCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i += 1; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}
const csvCell = (v) => {
  const t = v == null ? '' : String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
function readCsv(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  return { header, rows: lines.slice(1).map((l) => {
    const c = splitCsvLine(l); const o = {};
    header.forEach((h, i) => { o[h] = c[i] == null ? '' : c[i].trim(); });
    return o;
  }) };
}

const norm = (s) => String(s || '').replace(/\s+/g, '')
  .replace(/[，。、；：？！,.;:?!'"“”‘’（）()《》【】\[\]—\-–_/\\·]/g, '').toLowerCase();

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
/** 在选项里按文字定位答案：先全等，再包含 */
function locate(text, opts) {
  const t = norm(text);
  if (!t) return null;
  const pn = opts.map(norm);
  const exact = pn.indexOf(t);
  if (exact >= 0) return { idx: exact, how: '完全一致' };
  const cands = [];
  pn.forEach((p, i) => { if (p && (p.includes(t) || t.includes(p))) cands.push(i); });
  if (cands.length === 1) return { idx: cands[0], how: '包含匹配' };
  if (cands.length > 1) {
    // 多个候选时选重叠字符最多的
    let bestI = -1, bestLen = -1;
    cands.forEach((i) => {
      const p = pn[i];
      const L = t.length <= p.length ? t.length : p.length;
      if (L > bestLen) { bestLen = L; bestI = i; }
    });
    return { idx: bestI, how: `包含匹配（${cands.length} 个候选，取最长重叠）` };
  }
  return null;
}

const src = readCsv(srcCsv);
const key = readCsv(keyCsv);
const srcByNo = new Map();
src.rows.forEach((r, i) => {
  const m = /第(\d+)题/.exec(r.source || '');
  const no = m ? Number(m[1]) : i + 1;
  srcByNo.set(no, r);
});

console.log(`\n  真题: ${srcCsv}（${src.rows.length} 题）`);
console.log(`  答案: ${keyCsv}（${key.rows.length} 条）\n`);

let ok = 0, fixed = 0, fail = 0;
const report = [];

for (const k of key.rows) {
  const no = Number(k.qno);
  const r = srcByNo.get(no);
  if (!r) { report.push(`缺题  第${no}题 卷面没有对应题号`); fail += 1; continue; }

  const opts = ['optionA', 'optionB', 'optionC', 'optionD'].map((x) => r[x] || '');
  const loc = locate(k.ans_text, opts);
  if (!loc) {
    report.push(`对不上 第${no}题 [${r.id}]  答案文字「${k.ans_text.slice(0, 20)}」不在卷面选项中`);
    fail += 1;
    continue;
  }
  const letter = LETTERS[loc.idx];
  const same = letter === String(k.answer).toUpperCase();
  r.answer = letter;
  if (same) { ok += 1; } else { fixed += 1; }
  report.push(
    `${same ? '一致 ' : '纠正 '} 第${String(no).padStart(2)}题 [${r.id}]  ` +
    `来源${k.answer} → 卷面 ${letter}.${opts[loc.idx].slice(0, 22)}  （${loc.how}）`
  );
}

if (outCsv) {
  const outLines = [src.header.map(csvCell).join(',')];
  for (const r of src.rows) outLines.push(src.header.map((h) => csvCell(r[h])).join(','));
  fs.writeFileSync(outCsv, `\uFEFF${outLines.join('\r\n')}\r\n`, 'utf8');
  console.log(`  已写出: ${outCsv}\n`);
}

report.forEach((l) => console.log(`    ${l}`));
console.log(`\n  一致 ${ok} 题 · 按卷面纠正 ${fixed} 题 · 对不上 ${fail} 题\n`);
