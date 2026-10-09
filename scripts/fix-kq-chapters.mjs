/**
 * 修正《考情分析》来源变型题的章节归属。
 *
 * 背景：两份材料的「考点编号」体系不同——
 *   《知识点汇总》（考纲权威）：毛概部分 考点1=毛泽东思想 … 考点11=依靠力量
 *   《题型及考情分析》        ：毛概部分 考点1=中国化历程 … 考点5=邓小平理论、
 *                              考点6=三个代表、考点7=科学发展观、考点8=习近平新时代、
 *                              考点9=总任务、考点10=五位一体、考点11=四个全面、
 *                              考点12=国防军队、考点13=大国外交、考点14=党的领导
 * 第一份变型题按《考情分析》编号写了 p2-6~p2-11，与现有章节名（政治建设/文化建设/…）冲突，
 * 会造成「章节名叫政治建设、里面却考三个代表」。
 *
 * 本脚本把冲突的题重新归入按《考情分析》体系新建的 p3-* 章节。
 *
 *   node scripts/fix-kq-chapters.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'work', 'variants-毛概.csv');

/** 旧 chapterId -> 新 chapterId（只列需要改的） */
const REMAP = {
  'p2-6': 'p3-3', // 三个代表
  'p2-7': 'p3-4', // 科学发展观
  'p2-8': 'p3-5', // 习近平新时代中特思想（含总任务）
  'p2-9': 'p3-6', // 五位一体总体布局
  'p2-10': 'p3-7', // 四个全面战略布局
  'p2-11': 'p3-8', // 国防军队 / 大国外交 / 党的领导
  // p2-1~p2-5 与考纲命名一致（毛泽东思想 / 新民主主义革命 / 社会主义本质 / 改革与开放 / 经济建设），保持不变
};

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

function csvCell(v) {
  const t = v == null ? '' : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

if (!fs.existsSync(FILE)) {
  console.error(`找不到文件: ${FILE}`);
  process.exit(1);
}

const raw = fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
const header = splitCsvLine(lines[0]).map((h) => h.trim());
const ci = header.indexOf('chapterId');

const counts = {};
const out = [header.map(csvCell).join(',')];

for (const line of lines.slice(1)) {
  const cells = splitCsvLine(line);
  const oldId = cells[ci];
  if (REMAP[oldId]) {
    cells[ci] = REMAP[oldId];
    counts[`${oldId} -> ${REMAP[oldId]}`] = (counts[`${oldId} -> ${REMAP[oldId]}`] || 0) + 1;
  }
  out.push(cells.map(csvCell).join(','));
}

fs.writeFileSync(FILE, `\uFEFF${out.join('\r\n')}\r\n`, 'utf8');

console.log('\n  章节归属修正完成：');
Object.entries(counts).forEach(([k, v]) => console.log(`    ${k}  ${v} 题`));
console.log(`\n  文件已更新: ${path.relative(ROOT, FILE)}\n`);
