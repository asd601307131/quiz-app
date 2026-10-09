/**
 * 合并多份章节定义 CSV，输出一份完整章节表。
 *
 *   node tools/merge-chapters.mjs work/成考章节.csv work/真题章节.csv ... -o work/全部章节.csv
 *
 * 后出现的同名 id 覆盖先前的定义，便于手工微调顺序与描述。
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const outIdx = args.findIndex((a) => a === '-o' || a === '--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : 'work/全部章节.csv';
const inputs = args.filter((a, i) => i !== outIdx && i !== outIdx + 1);

if (!inputs.length) {
  console.error('用法: node tools/merge-chapters.mjs <章节csv...> [-o 输出路径]');
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

const map = new Map();
const order = [];

for (const file of inputs) {
  if (!fs.existsSync(file)) {
    console.warn(`  跳过不存在的文件: ${file}`);
    continue;
  }
  const lines = fs
    .readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = {
    id: header.indexOf('id'),
    name: header.indexOf('name'),
    desc: header.indexOf('desc'),
    icon: header.indexOf('icon'),
  };

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const id = (cells[idx.id] || '').trim();
    if (!id) continue;
    if (!map.has(id)) order.push(id);
    map.set(id, {
      id,
      name: (cells[idx.name] || '').trim() || id,
      desc: (cells[idx.desc] || '').trim(),
      icon: (cells[idx.icon] || '📘').trim(),
    });
    console.log(`  + ${id}  ${map.get(id).name}   (${path.basename(file)})`);
  }
}

const rows = order.map((id) => {
  const c = map.get(id);
  return [c.id, c.name, c.desc, c.icon].map(csvCell).join(',');
});

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(path.resolve(outPath), `\uFEFF${['id,name,desc,icon'].join(',')}\r\n${rows.join('\r\n')}\r\n`, 'utf8');

console.log(`\n  合并完成: ${map.size} 个章节 -> ${outPath}\n`);
