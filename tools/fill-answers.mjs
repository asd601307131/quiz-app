/**
 * 用已有题库（含答案）回填新转录真题的答案——**按选项文本比对，不按字母位置**。
 *
 * 背景：真题扫描卷上没有印答案。仓库里已有的 real-20xx-choice-* 来自第三方来源，
 * 带答案，但**选项顺序/措辞可能与官方卷不同**（已发现 2024 卷第 19 题顺序不同：
 * 旧来源 C=发展，官方卷 B=发展）。因此绝不能按字母回填，必须：
 *   1) 用题干匹配到旧题
 *   2) 取旧题「正确答案的文本」
 *   3) 在新题的选项里找到**文本相同**的那一项，其字母才是答案
 *   4) 找不到相同文本 → 标为「无法确认」，不填
 *
 *   node tools/fill-answers.mjs <待填CSV> <输出CSV> [--report]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const srcCsv = process.argv[2];
const outCsv = process.argv[3] || srcCsv.replace(/\.csv$/, '-已填答案.csv');
if (!srcCsv) {
  console.error('用法: node tools/fill-answers.mjs <待填CSV> [输出CSV]');
  process.exit(1);
}

/* ---------- CSV ---------- */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const csvCell = (v) => {
  const t = v == null ? '' : String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

function readCsv(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  // 注意：不能把键转成小写，否则 optionA / module 这类驼峰列名取不到值。
  // 这里保留原始列名，并提供大小写不敏感的取值函数。
  const rows = lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    const o = {};
    header.forEach((h, i) => { o[h] = cells[i] == null ? '' : cells[i].trim(); });
    o.__get = (name) => {
      if (o[name] != null) return o[name];
      const lower = name.toLowerCase();
      const key = header.find((h) => h.toLowerCase() === lower);
      return key ? o[key] || '' : '';
    };
    return o;
  });
  return { header, rows };
}

/** 归一化：去空白、标点、全角半角差异，用于文本比对 */
const norm = (s) => String(s || '')
  .replace(/\s+/g, '')
  .replace(/[，。、；：？！,.;:?!'"“”‘’（）()《》【】\[\]—\-–_/\\]/g, '')
  .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  .toLowerCase();

/** 题干相似度（字符二元组 Jaccard），用于判定是不是同一道题 */
function similarity(a, b) {
  const grams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
    return set;
  };
  const ga = grams(a); const gb = grams(b);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter += 1;
  return inter / (ga.size + gb.size - inter);
}

/* ---------- 已带答案的题库（从生成的 questions.js 读取）---------- */
async function loadBank() {
  // Windows 绝对路径必须转成 file:// URL，动态 import 才认
  const mod = await import(pathToFileURL(path.join(ROOT, 'src', 'data', 'questions.js')).href);
  return mod.QUESTIONS;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

function main() {
  loadBank().then((bank) => {
    // 只保留有答案、有选项的客观题
    const answered = bank.filter(
      (q) => Array.isArray(q.answer) && q.answer.length && Array.isArray(q.options) && q.options.length >= 2
    );
    if (process.env.FILL_DEBUG) {
      console.log(`\n[DEBUG] 题库总数 ${bank.length}，其中有答案的客观题 ${answered.length}`);
      const sample = answered[0];
      if (sample) console.log(`[DEBUG] 样例: ${sample.id} 答案=${JSON.stringify(sample.answer)} 选项数=${sample.options.length}`);
    }

    const { header, rows } = readCsv(srcCsv);
    const idx = (n) => header.findIndex((h) => h.toLowerCase() === n.toLowerCase());
    const val = (r, n) => (typeof r.__get === 'function' ? r.__get(n) : r[n] || '');
    const setVal = (r, n, v) => {
      const key = header.find((h) => h.toLowerCase() === n.toLowerCase()) || n;
      r[key] = v;
    };
    if (process.env.FILL_DEBUG) {
      console.log(`[DEBUG] CSV 行数 ${rows.length}，表头: ${header.join(' | ')}`);
      console.log(`[DEBUG] 首行 id=${val(rows[0], 'id')} answer="${val(rows[0], 'answer')}" stem="${val(rows[0], 'stem').slice(0, 24)}"`);
      console.log(`[DEBUG] optionA=${val(rows[0], 'optionA')} | optionB=${val(rows[0], 'optionB')}\n`);
    }
    const report = [];
    let filled = 0;
    let byText = 0;
    let byLetter = 0;

    for (const r of rows) {
      const stem = val(r, 'stem');
      const opts = ['optionA', 'optionB', 'optionC', 'optionD'].map((k) => val(r, k));
      if (!stem || String(val(r, 'answer')).trim()) continue; // 已有答案就跳过

      // 找题干最相似的旧题
      let best = null;
      let bestSim = 0;
      for (const q of answered) {
        const sim = similarity(norm(stem), norm(q.stem));
        if (sim > bestSim) { bestSim = sim; best = q; }
      }
      if (!best || bestSim < 0.72) {
        report.push(`跳过  ${val(r, 'id')}  相似度 ${(bestSim * 100).toFixed(0)}%  「${stem.slice(0, 26)}」`);
        continue;
      }

      // 旧题正确答案的文本
      const rightLetters = best.answer.map((x) => String(x).toUpperCase());
      const rightTexts = rightLetters
        .map((L) => best.options[LETTERS.indexOf(L)])
        .filter((t) => t != null);

      // 在新题选项里按**文本**找
      const newNorm = opts.map(norm);
      const hits = [];
      for (const rt of rightTexts) {
        const i = newNorm.indexOf(norm(rt));
        if (i >= 0) hits.push(LETTERS[i]);
      }

      if (hits.length === rightLetters.length && hits.length) {
        const filledLetters = hits.join('');
        setVal(r, 'answer', filledLetters);
        if (process.env.FILL_DEBUG) {
          console.log(`[DEBUG] ${val(r, 'id')} 填入 ${filledLetters}`);
        }
        filled += 1;
        byText += 1;
        const changed = filledLetters !== rightLetters.join('');
        report.push(
          `填入  ${val(r, 'id')}  相似度 ${(bestSim * 100).toFixed(0)}%  ` +
          `旧答案 ${rightLetters.join('')} → 卷面字母 ${filledLetters}${changed ? '  ⚠ 选项顺序不同，已按文本纠正' : ''}`
        );
      } else {
        // 文本对不上：不猜，只报告
        report.push(
          `存疑  ${val(r, 'id')}  相似度 ${(bestSim * 100).toFixed(0)}%  ` +
          `旧正确答案文本「${(rightTexts[0] || '').slice(0, 24)}」未在卷面选项中找到`
        );
      }
    }

    // 输出
    const outLines = [header.map(csvCell).join(',')];
    for (const r of rows) outLines.push(header.map((h) => csvCell(r[h])).join(','));
    fs.writeFileSync(outCsv, `\uFEFF${outLines.join('\r\n')}\r\n`, 'utf8');

    console.log(`\n  源文件: ${path.relative(ROOT, srcCsv)}`);
    console.log(`  输出:   ${path.relative(ROOT, outCsv)}`);
    console.log(`  共 ${rows.length} 题，按选项文本成功回填 ${filled} 题\n`);
    report.forEach((l) => console.log(`    ${l}`));
    console.log('');
  });
}

main();
