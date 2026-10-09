/**
 * 用结构化解析的主观题替换掉旧的错误数据。
 *
 * 背景：早期由 parse-politics.mjs 生成的 subj-jd / subj-bx 题目存在错配——
 *   辨析题块 A 的答案区实际只有判断正误，紧随其后的简答题答案被误拼进相邻题，
 *   造成「题干问社会规律、答案写社会主义本质」这类严重错误。
 * 现在改为 parse-subjective.mjs 按行号区间精确解析（见该脚本注释）。
 *
 *   node scripts/rebuild-bank.mjs
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CHAPTERS = path.join('work', '全部章节.csv');

/** 按顺序导入；第一个不带 --append */
const SOURCES = [
  'work/成考题库-政治.csv',
  'work/成考题库-主观题.csv', // 结构化解析的辨析题 + 简答论述（替换旧 subj-*）
  'work/成考题库-真题.csv',
  'work/成考题库-英语与策略.csv',
  'work/成考题库-英语语法.csv',
  'work/variants-哲学.csv',
  'work/variants-哲学2.csv',
  'work/variants-哲学3.csv',
  'work/variants-毛概.csv',
  'work/variants-毛概2a.csv',
  'work/variants-毛概2b.csv',
  'work/variants-补漏.csv',
];

/** 从 CSV 中删除某章节的记录 */
function dropChapter(file, chapterIds) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return 0;
  const raw = fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  const keep = [lines[0]];
  let dropped = 0;
  for (const line of lines.slice(1)) {
    const head = line.slice(0, line.indexOf(',', line.indexOf(',') + 1));
    if (chapterIds.some((c) => head.endsWith(`,${c}`))) {
      dropped += 1;
      continue;
    }
    keep.push(line);
  }
  if (dropped) fs.writeFileSync(full, `\uFEFF${keep.join('\r\n')}\r\n`, 'utf8');
  return dropped;
}

console.log('\n  1) 移除旧的 subj-* 主观题记录');
for (const f of ['work/成考题库-政治.csv', 'work/成考题库-真题.csv']) {
  const n = dropChapter(f, ['subj-bx', 'subj-jd']);
  if (n) console.log(`     ${f}: 删除 ${n} 条`);
}

console.log('\n  2) 重新导入全部题库');
let failed = false;
SOURCES.forEach((file, i) => {
  const args = ['scripts/import-questions.mjs', file, '--chapters', CHAPTERS];
  if (i > 0) args.splice(2, 0, '--append');
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = /解析结果:\s*(\d+)\s*题/.exec(out);
  const err = out.split('\n').filter((l) => /错误|失败|无法/.test(l)).slice(0, 2);
  console.log(`     ${m ? m[1].padStart(4) : '  ??'} 题  ${path.basename(file)}${err.length ? `  ⚠ ${err.join(' ')}` : ''}`);
  if (r.status !== 0) failed = true;
});

if (failed) {
  console.error('\n  导入过程出现错误，请检查上面的输出\n');
  process.exit(1);
}

console.log('\n  3) 完成\n');
