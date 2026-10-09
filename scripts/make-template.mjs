/**
 * 生成题库导入模板（CSV）。
 *
 *   node scripts/make-template.mjs                # 输出到 public/题库导入模板.csv
 *   node scripts/make-template.mjs my.csv         # 指定输出文件名
 *
 * 模板里每一行是一道示例题，覆盖全部 5 种题型，照着改即可。
 * 用 Excel 打开时请另存为「CSV UTF-8（逗号分隔）」，避免中文乱码。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const COLUMNS = [
  'id',
  'chapterId',
  'difficulty',
  'type',
  'stem',
  'optionA',
  'optionB',
  'optionC',
  'optionD',
  'optionE',
  'answer',
  'answerText',
  'analysis',
  'tags',
];

const ROWS = [
  // 单选
  {
    id: 'demo-01',
    chapterId: 'demo',
    difficulty: '简单',
    type: '单选',
    stem: '进入生产现场前，首先应当做的是？',
    optionA: '直接进入作业',
    optionB: '正确佩戴劳动防护用品',
    optionC: '先拍照留档',
    optionD: '等待班长口头通知',
    answer: 'B',
    analysis: '进入现场前必须按规定佩戴防护用品，这是最基本的安全要求。',
    tags: '安全,入场',
  },
  // 多选
  {
    id: 'demo-02',
    chapterId: 'demo',
    difficulty: '中等',
    type: '多选',
    stem: '下列哪些属于动火作业前的必要措施？（多选）',
    optionA: '办理动火作业许可证',
    optionB: '清理周边可燃物',
    optionC: '配备灭火器材与监护人',
    optionD: '作业结束后无需检查现场',
    answer: 'ABC',
    analysis: '动火作业需许可、清理、监护三同时；作业结束后还必须复查现场，确认无残火。',
    tags: '动火,作业许可',
  },
  // 判断（选项固定为 正确/错误，不用填 option 列）
  {
    id: 'demo-03',
    chapterId: 'demo',
    difficulty: '简单',
    type: '判断',
    stem: '发现安全隐患可以先记录下来，等下班后再上报。',
    answer: '错',
    analysis: '重大隐患必须立即上报并处置，拖延可能导致事故。',
    tags: '隐患',
  },
  // 填空（多个可接受答案用 | 分隔）
  {
    id: 'demo-04',
    chapterId: 'demo',
    difficulty: '中等',
    type: '填空',
    stem: '安全生产方针是“安全第一、______、综合治理”。',
    answer: '预防为主|预防为主，',
    analysis: '完整表述为“安全第一、预防为主、综合治理”。',
    tags: '方针',
  },
  // 简答（不自动判分，交卷后展示参考答案）
  {
    id: 'demo-05',
    chapterId: 'demo',
    difficulty: '困难',
    type: '简答',
    stem: '简述发现火情后的处置步骤。',
    answerText: '1. 立即报警并通知周围人员；2. 在保证自身安全前提下使用灭火器材初期扑救；3. 切断电源或气源；4. 按疏散路线撤离，不乘坐电梯；5. 到集合点清点人数并配合救援。',
    analysis: '要点是「报警—初期扑救—断电断气—有序疏散—清点汇报」，顺序与自身安全优先不可颠倒。',
    tags: '应急,消防',
  },
];

/* ------------------------------------------------------------------ */

function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(columns, rows) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c])).join(','));
  }
  return lines.join('\r\n');
}

const outName = process.argv[2] || '题库导入模板.csv';
const outDir = path.join(ROOT, 'public');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, outName);

// Excel 需要 BOM 才能正确识别 UTF-8 中文
fs.writeFileSync(outPath, `\uFEFF${toCsv(COLUMNS, ROWS)}\r\n`, 'utf8');

/* ---- 附加：章节定义模板（可选，放在同目录由导入脚本读取） ---- */

const chapterPath = path.join(outDir, '章节模板.csv');
if (!fs.existsSync(chapterPath)) {
  const chapterCsv = toCsv(
    ['id', 'name', 'desc', 'icon'],
    [
      { id: 'demo', name: '示例章节', desc: '把这里改成你的章节名与说明', icon: '📘' },
      { id: 'ch2', name: '第二章', desc: '章节说明', icon: '📗' },
    ]
  );
  fs.writeFileSync(chapterPath, `\uFEFF${chapterCsv}\r\n`, 'utf8');
  console.log(`  已生成章节模板: ${path.relative(ROOT, chapterPath)}`);
}

console.log(`\n  题库模板已生成: ${path.relative(ROOT, outPath)}`);
console.log(`  包含 ${COLUMNS.length} 列、${ROWS.length} 道示例题（单选/多选/判断/填空/简答）`);
console.log('\n  使用方式：');
console.log('    1. 用 Excel 或 WPS 打开该模板，替换成你的题目（保持表头不变）');
console.log('    2. 另存为「CSV UTF-8（逗号分隔）」格式');
console.log('    3. 运行：node scripts/import-questions.mjs <你的文件.csv>');
console.log('');
