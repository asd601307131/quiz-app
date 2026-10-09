/**
 * 题干 / 参考答案 配对一致性检查。
 *
 * 用于发现「题干问 A、答案写 B」这类错配——比选项错误更隐蔽，
 * 但对复习的误导最严重。
 *
 *   node work\pair-audit.mjs work/成考题库-政治.csv
 *
 * 判据：题干与参考答案若几乎没有共同实词，则高度可疑。
 * 另外检查参考答案是否误收了解题技巧类文字（「关键词捕捉题干信号」等）。
 */

import fs from 'node:fs';

const file = process.argv[2] || 'work/成考题库-政治.csv';

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

const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
const header = splitCsvLine(lines[0]).map((h) => h.trim());
const idx = (n) => header.indexOf(n);

/** 提取中文实词（2 字以上），去掉常见虚词与套话 */
const STOP = new Set([
  '什么', '怎样', '如何', '哪些', '为什么', '简述', '论述', '说明', '主要', '基本', '重要',
  '社会', '发展', '中国', '我国', '社会主义', '特色', '理论', '内容', '意义', '作用', '含义',
  '以下', '关于', '的是', '可以', '一一', '一个', '不是', '就是', '以及', '或者', '进行',
]);

function keywords(text, limit = 40) {
  const clean = String(text || '').replace(/[【】（）()《》「」“”"'’,，。、；：？！\-—…%　\s]/g, '');
  const grams = new Set();
  for (let i = 0; i < clean.length - 1; i += 1) {
    const g = clean.slice(i, i + 2);
    if (!STOP.has(g)) grams.add(g);
  }
  return [...grams].slice(0, limit * 3);
}

/** 技巧类套话特征：出现在参考答案里说明配错了 */
const STRATEGY_MARKERS = [
  '关键词捕捉题干信号', '仔细审题', '草稿纸上写下', '多角度能够提高命中率',
  '复述材料', '纵向层层递进', '横向分方面展开', '如果背住的原理文字量太少',
  '表述尽量准确', '不苛求一字不差', '反面阐述',
];

const rows = [];
for (const line of lines.slice(1)) {
  const c = splitCsvLine(line);
  const type = c[idx('type')];
  if (type !== '简答' && type !== '判断') continue;
  const stem = c[idx('stem')] || '';
  const answer = c[idx('answerText')] || c[idx('analysis')] || '';
  rows.push({
    id: c[idx('id')],
    chapterId: c[idx('chapterId')],
    type,
    stem,
    answer,
  });
}

console.log(`\n检查 ${file}：主观题 ${rows.length} 道\n`);

const mismatched = [];
const strategyLeak = [];

for (const r of rows) {
  // 技巧套话泄漏
  const leaked = STRATEGY_MARKERS.filter((m) => r.answer.includes(m));
  if (leaked.length) {
    strategyLeak.push({ ...r, leaked });
    continue;
  }

  // 判断题的答案本身就很短（「该说法错误」），关键词重合度不适用，跳过
  if (r.type === '判断') continue;

  const sk = new Set(keywords(r.stem));
  const ak = keywords(r.answer);
  if (!sk.size || !ak.length) continue;
  let hit = 0;
  for (const g of ak) if (sk.has(g)) hit += 1;
  const overlap = hit / Math.min(ak.length, sk.size);
  if (overlap < 0.05) mismatched.push({ ...r, overlap });
}

console.log(`──────── 参考答案实为「答题技巧」文字：${strategyLeak.length} 道 ────────`);
strategyLeak.forEach((r) => {
  console.log(`  ✗ [${r.id}] 题干：${r.stem.slice(0, 40)}`);
  console.log(`      答案开头：${r.answer.slice(0, 50)}`);
  console.log(`      命中套话：${r.leaked.join(' / ')}`);
});

console.log(`\n──────── 题干与答案几乎无关联：${mismatched.length} 道 ────────`);
mismatched
  .sort((a, b) => a.overlap - b.overlap)
  .forEach((r) => {
    console.log(`  ✗ [${r.id}] 重合度 ${(r.overlap * 100).toFixed(1)}%`);
    console.log(`      题干：${r.stem.slice(0, 46)}`);
    console.log(`      答案：${r.answer.slice(0, 46)}`);
  });

console.log(`\n结论：${strategyLeak.length + mismatched.length} 道需要人工修正\n`);
process.exit(strategyLeak.length + mismatched.length ? 1 : 0);
