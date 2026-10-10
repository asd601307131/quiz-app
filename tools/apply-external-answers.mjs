/**
 * 用外部来源（网络搜到的考生回忆版/官方发布版）给真题回填答案。
 *
 * 与 tools/fill-answers.mjs 的区别：那个用**题库**回填，这个用**外部答案表**。
 * 匹配策略（两道关卡，都必须过）：
 *   1) 题干相似度 —— 找外部答案表里最像的一条
 *   2) 选项文本校验 —— 把外部答案的字母换成"该字母对应的选项文字"，
 *      再在卷面选项里找相同文字；找不到就不采信
 * 第二关是关键：回忆版常把选项顺序打乱，甚至选项文字不同，
 * 只看字母会填错。
 *
 *   node tools/apply-external-answers.mjs <真题CSV> <外部答案CSV> <输出CSV> [年份]
 */

import fs from 'node:fs';
import path from 'node:path';

const [srcCsv, keyCsv, outCsv, yearArg] = process.argv.slice(2);
if (!srcCsv || !keyCsv) {
  console.error('用法: node tools/apply-external-answers.mjs <真题CSV> <外部答案CSV> <输出CSV> [年份]');
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
  .replace(/[，。、；：？！,.;:?!'"“”‘’（）()《》【】\[\]—\-–_/\\]/g, '')
  .toLowerCase();

function similarity(a, b) {
  const grams = (s) => { const set = new Set(); for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2)); return set; };
  const ga = grams(a), gb = grams(b);
  if (!ga.size || !gb.size) return 0;
  let inter = 0; for (const g of ga) if (gb.has(g)) inter += 1;
  return inter / (ga.size + gb.size - inter);
}

/** 包含度：短串的字符二元组有多大比例出现在长串中（对「回忆版缩写」比 Jaccard 更合适） */
function containment(short, long) {
  const grams = (s) => { const set = new Set(); for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2)); return set; };
  const gs = grams(short), gl = grams(long);
  if (!gs.size) return 0;
  let hit = 0; for (const g of gs) if (gl.has(g)) hit += 1;
  return hit / gs.size;
}

/** 综合相似度：Jaccard 与双向包含度的平均，兼顾缩写与改写 */
function matchScore(a, b) {
  return (similarity(a, b) + containment(a, b) + containment(b, a)) / 3;
}

/**
 * 答案文字匹配：外部答案文字与卷面选项的关系。
 * 返回 { idx, how } 或 null。
 *   完全一致 → 高置信
 *   包含关系 → 中置信（如「现象表现本质规律」vs「现象表现本质的规律」）
 *   其余 → 不采信
 */
function matchOptionByText(target, opts) {
  const t = norm(target);
  if (!t) return null;
  const paperNorm = opts.map(norm);

  const exact = paperNorm.indexOf(t);
  if (exact >= 0) return { idx: exact, how: '答案文字与选项完全一致' };

  const cands = [];
  paperNorm.forEach((p, i) => {
    if (!p) return;
    if (p.includes(t) || t.includes(p)) cands.push(i);
  });
  if (cands.length === 1) {
    return {
      idx: cands[0],
      how: `答案文字与选项为包含关系（外部「${target.slice(0, 16)}」↔ 卷面「${opts[cands[0]].slice(0, 16)}」）`,
    };
  }
  return null;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

const src = readCsv(srcCsv);
const keys = readCsv(keyCsv).rows;
// 年份过滤：外部答案表里含多年份
const wantedYear = yearArg || (src.rows[0] && /(\d{4})/.exec(src.rows[0].source || '')?.[1]) || '';
const keyRows = keys.filter((k) => !wantedYear || String(k.year) === String(wantedYear));

console.log(`\n  真题: ${srcCsv}（${src.rows.length} 题）`);
console.log(`  答案表: ${keyCsv} 年份=${wantedYear || '(全部)'} 可用 ${keyRows.length} 条\n`);

let filled = 0;
const report = [];

for (const r of src.rows) {
  if ((r.answer || '').trim()) continue;         // 已有答案不动
  const stem = r.stem || '';
  const opts = ['optionA', 'optionB', 'optionC', 'optionD'].map((k) => r[k] || '');

  const stemNorm = norm(stem);
  let best = null, bs = 0;
  for (const k of keyRows) {
    const s = matchScore(stemNorm, norm(k.stem_hint));
    if (s > bs) { bs = s; best = k; }
  }
  if (!best || bs < 0.75) {
    report.push(`跳过  ${r.id}  题干匹配度 ${(bs * 100).toFixed(0)}%  「${stem.slice(0, 24)}」`);
    continue;
  }

  // 第二道关卡：必须能用**答案文字**在卷面选项里定位，否则不采信
  const letter = String(best.answer).trim().toUpperCase();
  const extAnsText = best[`opt${letter}`] || '';
  if (!extAnsText) {
    report.push(`跳过  ${r.id}  外部答案表缺少答案文字，无法校验，不采信`);
    continue;
  }
  const m = matchOptionByText(extAnsText, opts);
  if (!m) {
    report.push(
      `存疑  ${r.id}  题干匹配度 ${(bs * 100).toFixed(0)}%  外部答案文字「${extAnsText.slice(0, 18)}」` +
      `与卷面选项都对不上，不采信`
    );
    continue;
  }

  const finalLetter = LETTERS[m.idx];
  r.answer = finalLetter;
  filled += 1;
  const conf = bs >= 0.9 && m.how.includes('完全一致') ? '高' : bs >= 0.85 ? '中' : '低';
  report.push(
    `填入  ${r.id}  题干匹配 ${(bs * 100).toFixed(0)}%（置信 ${conf}）  ` +
    `答案 ${finalLetter}.${opts[m.idx].slice(0, 18)}` +
    `  ← ${best.source} 第${best.qno}题（外部字母 ${letter}${letter !== finalLetter ? '，顺序不同已纠正' : ''}）  ${m.how}`
  );
}

const outLines = [src.header.map(csvCell).join(',')];
for (const r of src.rows) outLines.push(src.header.map((h) => csvCell(r[h])).join(','));
fs.writeFileSync(outCsv, `\uFEFF${outLines.join('\r\n')}\r\n`, 'utf8');

console.log(`  共 ${src.rows.length} 题，回填 ${filled} 题 → ${outCsv}\n`);
report.forEach((l) => console.log(`    ${l}`));
console.log('');
