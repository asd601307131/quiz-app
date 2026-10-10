/**
 * 把 CSV/TSV 题目表转换为 src/data/questions.js（可重复执行）。
 *
 *   node scripts/import-questions.mjs 我的题库.csv
 *   node scripts/import-questions.mjs 我的题库.csv --append          # 保留现有题目，追加/覆盖同 id
 *   node scripts/import-questions.mjs 我的题库.csv --out src/data/my-bank.js
 *   node scripts/import-questions.mjs 我的题库.csv --chapters public/章节模板.csv
 *   node scripts/import-questions.mjs 我的题库.csv --dry-run         # 只校验不写文件
 *
 * 表头（顺序不限，大小写不限）：
 *   id  chapterId  difficulty  type  stem
 *   optionA..optionE  answer  answerText  analysis  tags
 *
 * 题型的写法很宽松：单选/single/1、多选/multiple/2、判断/judge/tf、
 * 填空/fill/blank、简答/short/essay 都能识别。
 * 难度：简单/easy/易、中等/medium/中、困难/hard/难。
 *
 * 答案列的写法：
 *   单选题答案       A  或 a  或 1
 *   多选题答案       ABC / A,B,D / A、B、D / A B D 都可以
 *   判断题答案       对/错、正确/错误、T/F、√/×
 *   填空题答案       多个可接受答案用 | 分隔，例如  预防为主|预防为主，
 *   简答题参考答案   写在 answerText 列（不自动判分）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPoints } from '../src/core/points.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ------------------------------------------------------------------ */
/* 参数解析                                                            */
/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));

if (!positional.length || flags.has('--help')) {
  console.log(`
用法: node scripts/import-questions.mjs <题目表.csv> [选项]

  --append              保留现有题库，同 id 覆盖、新 id 追加（默认是整体替换）
  --out <文件>          输出文件，默认 src/data/questions.js
  --chapters <文件>      章节定义表（列: id,name,desc,icon），可选
  --dry-run             只做校验与统计，不写文件

先运行 node scripts/make-template.mjs 生成模板。
`);
  process.exit(positional.length ? 0 : 1);
}

const inputArg = positional[0];
const inputPath = path.isAbsolute(inputArg) ? inputArg : path.join(process.cwd(), inputArg);
const appendMode = flags.has('--append');
const dryRun = flags.has('--dry-run');

function flagValue(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const outPath = path.resolve(ROOT, flagValue('--out', 'src/data/questions.js'));
const chaptersArg = flagValue('--chapters', path.join(ROOT, 'public', '章节模板.csv'));
const chaptersPath = fs.existsSync(chaptersArg) ? chaptersArg : null;

if (!fs.existsSync(inputPath)) {
  console.error(`\n  找不到输入文件: ${inputPath}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* CSV 解析（支持引号、逗号、换行、Tab 分隔）                          */
/* ------------------------------------------------------------------ */

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  if (tabs > commas && tabs > semis) return '\t';
  if (semis > commas) return ';';
  return ',';
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // 忽略，交给 \n 处理
    } else {
      field += ch;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/* ------------------------------------------------------------------ */
/* 字段归一化                                                          */
/* ------------------------------------------------------------------ */

const TYPE_ALIASES = {
  单选: 'single', 单选题: 'single', single: 'single', radio: 'single', 1: 'single', 一: 'single',
  多选: 'multiple', 多选题: 'multiple', multiple: 'multiple', checkbox: 'multiple', 2: 'multiple', 二: 'multiple',
  判断: 'judge', 判断题: 'judge', judge: 'judge', tf: 'judge', truefalse: 'judge', 3: 'judge',
  填空: 'fill', 填空题: 'fill', fill: 'fill', blank: 'fill', 4: 'fill',
  简答: 'short', 简答题: 'short', short: 'short', 问答: 'short', 5: 'short',
  // 论述是独立题型（20 分大题），不能并进简答
  论述: 'essay', 论述题: 'essay', essay: 'essay', 6: 'essay',
};

const DIFF_ALIASES = {
  简单: 'easy', 易: 'easy', easy: 'easy', 1: 'easy', 低: 'easy',
  中等: 'medium', 中: 'medium', medium: 'medium', normal: 'medium', 2: 'medium',
  困难: 'hard', 难: 'hard', hard: 'hard', difficult: 'hard', 3: 'hard', 高: 'hard',
};

const TRUE_WORDS = ['对', '正确', '是', 't', 'true', 'y', 'yes', '√', 'v', '1'];
const FALSE_WORDS = ['错', '错误', '否', 'f', 'false', 'n', 'no', '×', 'x', '0'];

function normKey(key) {
  return String(key || '')
    .replace(/^\uFEFF/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function pick(row, ...names) {
  for (const name of names) {
    const v = row[normKey(name)];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function parseType(raw, options) {
  const key = normKey(raw);
  if (TYPE_ALIASES[key]) return TYPE_ALIASES[key];

  // 推断：没有选项列 → 有 answerText 则简答，否则填空
  if (!options.length) return 'fill';

  // 两个选项且是 正确/错误 → 判断
  if (
    options.length === 2 &&
    /^(正确|对|是|true)$/i.test(options[0]) &&
    /^(错误|错|否|false)$/i.test(options[1])
  ) {
    return 'judge';
  }

  return options.length ? null : 'fill';
}

function parseDifficulty(raw) {
  const key = normKey(raw);
  return DIFF_ALIASES[key] || null;
}

/** 解析选项题答案 -> 字母数组；返回 { list, error } */
function parseChoiceAnswer(raw, optionCount) {
  const text = String(raw || '').trim();
  if (!text) return { list: [], error: '缺少答案' };

  const upper = text.toUpperCase();

  // 形如 ABC / A,B,D / A、B、D / A B D
  const letters = upper.match(/[A-H]/g);
  if (letters && !/[^A-H\s,，、;；/|]/.test(upper)) {
    const list = [...new Set(letters)].sort();
    const invalid = list.filter((l) => l.charCodeAt(0) - 65 >= optionCount);
    if (invalid.length) return { list, error: `答案 ${invalid.join(',')} 超出选项范围（共 ${optionCount} 个选项）` };
    return { list, error: null };
  }

  // 形如 1,3 或 1、3（数字代表第几个选项）
  if (/^[\d\s,，、;；/|]+$/.test(text)) {
    const nums = [...new Set((text.match(/\d+/g) || []).map(Number))].sort((a, b) => a - b);
    if (!nums.length) return { list: [], error: '答案无法识别' };
    const list = nums.map((n) => String.fromCharCode(64 + n));
    const invalid = nums.filter((n) => n < 1 || n > optionCount);
    if (invalid.length) return { list, error: `答案序号 ${invalid.join(',')} 超出选项范围（共 ${optionCount} 个选项）` };
    return { list, error: null };
  }

  return { list: [], error: `答案「${text}」无法识别，请填写选项字母（如 A 或 ABD）` };
}

/** 解析判断题答案 -> ['A'] / ['B'] */
function parseJudgeAnswer(raw) {
  const key = normKey(raw);
  if (TRUE_WORDS.includes(key)) return { list: ['A'], error: null };
  if (FALSE_WORDS.includes(key)) return { list: ['B'], error: null };
  // 也接受直接写 A/B
  if (key === 'a') return { list: ['A'], error: null };
  if (key === 'b') return { list: ['B'], error: null };
  return { list: [], error: `判断题答案「${raw}」无法识别，请填写 对/错 或 正确/错误` };
}

/** 解析填空题答案 -> 字符串数组（| 或 ; 分隔） */
function parseFillAnswer(raw) {
  const text = String(raw || '').trim();
  if (!text) return { list: [], error: '缺少答案' };
  const list = text
    .split(/[|；;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { list: [...new Set(list)], error: list.length ? null : '答案为空' };
}

function parseTags(raw) {
  return String(raw || '')
    .split(/[,，、;；|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function jsString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')}'`;
}

function jsArray(list) {
  return `[${list.map(jsString).join(', ')}]`;
}

/* ------------------------------------------------------------------ */
/* 读取与转换                                                          */
/* ------------------------------------------------------------------ */

const rawText = fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
const delimiter = detectDelimiter(rawText);
const table = parseDelimited(rawText, delimiter);
if (table.length < 2) {
  console.error(`\n  表格内容太少（${table.length} 行），至少需要表头 + 1 行数据`);
  process.exit(1);
}

const header = table[0].map((h) => normKey(h));
const rows = table.slice(1).map((cells) => {
  const obj = {};
  header.forEach((h, i) => {
    obj[h] = cells[i] == null ? '' : String(cells[i]).trim();
  });
  return obj;
});

console.log(`\n  输入文件: ${path.relative(ROOT, inputPath)}`);
console.log(`  分隔符:   ${delimiter === '\t' ? 'Tab' : delimiter}   数据行: ${rows.length}`);

const warnings = [];
const errors = [];
const questions = [];
const seenIds = new Set();
const chapterIds = new Set();

rows.forEach((row, index) => {
  const lineNo = index + 2; // 表头占第 1 行
  const id = pick(row, 'id', '编号', '题号') || `q-${String(index + 1).padStart(3, '0')}`;
  const stem = pick(row, 'stem', '题干', '题目', 'question');
  const analysis = pick(row, 'analysis', '解析', '答案解析');
  const chapterId = pick(row, 'chapterId', 'chapter', '章节', '章节id') || 'default';

  if (!stem) {
    errors.push(`第 ${lineNo} 行: 题干为空`);
    return;
  }
  if (seenIds.has(id)) {
    errors.push(`第 ${lineNo} 行: 题目 id 重复（${id}）`);
    return;
  }

  const options = ['A', 'B', 'C', 'D', 'E']
    .map((L) => pick(row, `option${L}`, `选项${L}`, L))
    .filter((v) => v !== '');

  const typeRaw = pick(row, 'type', '题型');
  const type = parseType(typeRaw, options);

  if (!type) {
    errors.push(`第 ${lineNo} 行: 题型「${typeRaw}」无法识别（可用：单选/多选/判断/填空/简答）`);
    return;
  }

  const difficulty = parseDifficulty(pick(row, 'difficulty', '难度')) || 'medium';
  if (!pick(row, 'difficulty', '难度')) {
    warnings.push(`第 ${lineNo} 行: 未填难度，默认按「中等」处理`);
  }

  const answerRaw = pick(row, 'answer', '答案', '正确答案');
  const answerText = pick(row, 'answerText', '参考答案', '简答答案');
  // 考卷模块（马哲 / 毛泽东思想 / 邓小平理论等 / 习近平新时代 / 时政）。
  // 真卷选择题模块顺序几乎固定，有该字段时组卷会据此排序。
  const module = pick(row, 'module', '模块', '考卷模块');
  const q = {
    id,
    chapterId,
    difficulty,
    type,
    stem,
    ...(module ? { module } : {}),
    analysis: analysis || '（暂无解析）',
    tags: parseTags(pick(row, 'tags', '标签')),
  };

  if (type === 'single' || type === 'multiple') {
    if (options.length < 2) {
      errors.push(`第 ${lineNo} 行: ${type === 'single' ? '单选' : '多选'}题至少需要 2 个选项`);
      return;
    }
    if (options.length > 5) {
      errors.push(`第 ${lineNo} 行: 选项最多 5 个（A-E），当前 ${options.length} 个`);
      return;
    }
    const { list, error } = parseChoiceAnswer(answerRaw, options.length);
    if (error) {
      errors.push(`第 ${lineNo} 行: ${error}`);
      return;
    }
    if (type === 'single' && list.length !== 1) {
      errors.push(`第 ${lineNo} 行: 单选题答案应只有 1 项，当前 ${list.length} 项`);
      return;
    }
    if (type === 'multiple' && list.length < 2) {
      errors.push(`第 ${lineNo} 行: 多选题答案至少 2 项，当前 ${list.length} 项`);
      return;
    }
    q.options = options;
    q.answer = list;
  } else if (type === 'judge') {
    const { list, error } = parseJudgeAnswer(answerRaw);
    if (error) {
      errors.push(`第 ${lineNo} 行: ${error}`);
      return;
    }
    q.type = 'judge';
    q.options = ['正确', '错误'];
    q.answer = list;
  } else if (type === 'fill') {
    const { list, error } = parseFillAnswer(answerRaw);
    if (error) {
      errors.push(`第 ${lineNo} 行: ${error}`);
      return;
    }
    q.type = 'fill';
    q.answer = list;
  } else {
    if (!answerText && !answerRaw) {
      errors.push(`第 ${lineNo} 行: 简答题需要填写 answerText（参考答案）`);
      return;
    }
    q.type = 'short';
    q.answerText = answerText || answerRaw;
    if (!analysis) {
      warnings.push(`第 ${lineNo} 行: 简答题建议填写解析（评分要点）`);
    }
  }

  if (!analysis) {
    warnings.push(`第 ${lineNo} 行: 未填解析，已用占位文本`);
  }

  seenIds.add(id);
  chapterIds.add(chapterId);
  questions.push(q);
});

if (errors.length) {
  console.error(`\n  发现 ${errors.length} 个错误，未生成文件：`);
  errors.slice(0, 30).forEach((e) => console.error(`    ✗ ${e}`));
  if (errors.length > 30) console.error(`    ... 还有 ${errors.length - 30} 个`);
  console.error('');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 章节                                                                */
/* ------------------------------------------------------------------ */

const CHAPTER_META = {
  web: { name: 'Web 基础', desc: 'HTML 语义化、浏览器渲染与基础概念', icon: '🌐' },
  css: { name: 'CSS 布局', desc: '盒模型、Flex、定位与移动端适配', icon: '🎨' },
  js: { name: 'JavaScript', desc: '语言基础、作用域、异步与事件循环', icon: '⚡' },
  eng: { name: '前端工程化', desc: '模块化、构建、性能优化与调试', icon: '🛠️' },
  net: { name: '网络与安全', desc: 'HTTP、缓存、跨域与常见安全问题', icon: '🔐' },
};

/** 读取章节定义表（若存在） */
function readChapterFile(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const rows2 = parseDelimited(text, detectDelimiter(text));
  if (rows2.length < 2) return [];
  const head = rows2[0].map((h) => normKey(h));
  return rows2
    .slice(1)
    .map((cells) => {
      const obj = {};
      head.forEach((h, i) => {
        obj[h] = cells[i] == null ? '' : String(cells[i]).trim();
      });
      return {
        id: pick(obj, 'id', '章节id'),
        name: pick(obj, 'name', '章节名', '名称'),
        desc: pick(obj, 'desc', 'description', '说明', '描述'),
        icon: pick(obj, 'icon', '图标'),
      };
    })
    .filter((c) => c.id && c.name);
}

const chapterFileList = chaptersPath ? readChapterFile(chaptersPath) : [];
const chapterMap = new Map();
for (const c of chapterFileList) chapterMap.set(c.id, c);

const orderedChapterIds = [];
for (const q of questions) {
  if (!orderedChapterIds.includes(q.chapterId)) orderedChapterIds.push(q.chapterId);
}

const chapters = orderedChapterIds.map((id, i) => {
  const fromFile = chapterMap.get(id);
  const meta = CHAPTER_META[id];
  return {
    id,
    name: fromFile?.name || meta?.name || `第 ${i + 1} 章（${id}）`,
    desc: fromFile?.desc || meta?.desc || '章节说明待补充',
    icon: fromFile?.icon || meta?.icon || '📘',
  };
});

if (chaptersPath) {
  console.log(`  章节定义: ${path.relative(ROOT, chaptersPath)}`);
} else {
  warnings.push('未找到章节定义表，章节名称使用默认占位（可运行 make-template.mjs 生成后修改）');
}

/* ------------------------------------------------------------------ */
/* 合并（--append）                                                    */
/* ------------------------------------------------------------------ */

let finalQuestions = questions;
let finalChapters = chapters;

if (appendMode && fs.existsSync(outPath)) {
  const mod = await import(`${pathToFileUrl(outPath)}?t=${Date.now()}`);
  const existingQuestions = mod.QUESTIONS || [];
  const existingChapters = mod.CHAPTERS || [];

  const byId = new Map(existingQuestions.map((q) => [q.id, q]));
  let replaced = 0;
  for (const q of questions) {
    if (byId.has(q.id)) replaced += 1;
    byId.set(q.id, q);
  }
  finalQuestions = [...byId.values()];

  const chapterById = new Map(existingChapters.map((c) => [c.id, c]));
  for (const c of chapters) chapterById.set(c.id, c);
  finalChapters = [...chapterById.values()];

  console.log(`  追加模式: 新增/覆盖 ${questions.length} 题（其中覆盖同 id ${replaced} 题），最终 ${finalQuestions.length} 题`);
}

function pathToFileUrl(p) {
  return `file:///${p.replace(/\\/g, '/')}`;
}

/* ------------------------------------------------------------------ */
/* 生成文件                                                            */
/* ------------------------------------------------------------------ */

function renderQuestion(q, indent = '  ') {
  // 主观题：把参考答案拆成要点，方便手机端按「踩点给分」的方式背诵
  const points =
    (q.type === 'short' || q.type === 'judge') && q.answerText ? extractPoints(q.answerText) : [];

  const lines = [];
  lines.push(`${indent}{`);
  lines.push(`${indent}  id: ${jsString(q.id)},`);
  lines.push(`${indent}  chapterId: ${jsString(q.chapterId)},`);
  lines.push(`${indent}  difficulty: ${jsString(q.difficulty)},`);
  lines.push(`${indent}  type: ${jsString(q.type)},`);
  // 考卷模块（马哲 / 毛泽东思想 / 邓小平理论等 / 习近平新时代 / 时政）：
  // 真卷选择题的模块顺序几乎固定，组卷时据此排序，有则写入
  if (q.module) lines.push(`${indent}  module: ${jsString(q.module)},`);
  lines.push(`${indent}  stem: ${jsString(q.stem)},`);
  if (q.options) lines.push(`${indent}  options: ${jsArray(q.options)},`);
  if (q.answer) lines.push(`${indent}  answer: ${jsArray(q.answer)},`);
  if (q.answerText) lines.push(`${indent}  answerText: ${jsString(q.answerText)},`);
  if (points.length >= 2) lines.push(`${indent}  points: ${jsArray(points)},`);
  lines.push(`${indent}  analysis: ${jsString(q.analysis)},`);
  lines.push(`${indent}  tags: ${jsArray(q.tags || [])},`);
  lines.push(`${indent}},`);
  return lines.join('\n');
}

const byChapter = new Map();
for (const q of finalQuestions) {
  if (!byChapter.has(q.chapterId)) byChapter.set(q.chapterId, []);
  byChapter.get(q.chapterId).push(q);
}

const body = [];
body.push('/**');
body.push(' * 题库数据（由 scripts/import-questions.mjs 生成，可重复执行覆盖）。');
body.push(' *');
body.push(' * 题型与字段：');
body.push(" *   single   单选：options[string[]] + answer[string[]]（字母）");
body.push(" *   multiple 多选：同上，answer 多项，全对才得分");
body.push(" *   judge    判断：options 固定 ['正确','错误']，answer 为 ['A'](对) 或 ['B'](错)");
body.push(' *   fill     填空：answer 为可接受答案数组，命中任一即算对');
body.push(' *   short    简答：answerText 为参考答案，不自动判分');
body.push(' *');
body.push(' * 修改题库请改源表格后重新运行导入脚本，不要直接手改本文件。');
body.push(' */');
body.push('');
body.push('export const CHAPTERS = [');
for (const c of finalChapters) {
  body.push(`  { id: ${jsString(c.id)}, name: ${jsString(c.name)}, desc: ${jsString(c.desc)}, icon: ${jsString(c.icon || '📘')} },`);
}
body.push('];');
body.push('');
body.push('export const QUESTIONS = [');

for (const c of finalChapters) {
  const list = byChapter.get(c.id);
  if (!list || !list.length) continue;
  const title = `${c.name}（${list.length} 题）`;
  body.push(`  /* ${'-'.repeat(Math.max(4, 70 - title.length))} ${title} */`);
  for (const q of list) body.push(renderQuestion(q));
  body.push('');
}

body.push('];');
body.push('');
body.push('/** 按 id 建索引 */');
body.push('export const QUESTION_MAP = new Map(QUESTIONS.map((q) => [q.id, q]));');
body.push('');
body.push('export function getQuestion(id) {');
body.push('  return QUESTION_MAP.get(id) || null;');
body.push('}');
body.push('');
body.push('export function getChapter(chapterId) {');
body.push('  return CHAPTERS.find((c) => c.id === chapterId) || null;');
body.push('}');
body.push('');
body.push('/** 章节统计：题目数、各难度数量 */');
body.push('export function chapterStats(chapterId) {');
body.push('  const list = QUESTIONS.filter((q) => q.chapterId === chapterId);');
body.push('  const by = { easy: 0, medium: 0, hard: 0 };');
body.push('  list.forEach((q) => {');
body.push('    by[q.difficulty] = (by[q.difficulty] || 0) + 1;');
body.push('  });');
body.push('  return { total: list.length, ...by };');
body.push('}');
body.push('');
body.push('export const TYPE_LABEL = {');
body.push("  single: '单选题',");
body.push("  multiple: '多选题',");
body.push("  judge: '判断题',");
body.push("  fill: '填空题',");
body.push("  short: '简答题',");
body.push('};');
body.push('');

const output = body.join('\n');

/* ------------------------------------------------------------------ */
/* 统计与写出                                                          */
/* ------------------------------------------------------------------ */

const stats = { single: 0, multiple: 0, judge: 0, fill: 0, short: 0 };
for (const q of finalQuestions) stats[q.type] += 1;
const diffStats = { easy: 0, medium: 0, hard: 0 };
for (const q of finalQuestions) diffStats[q.difficulty] += 1;

console.log(`\n  解析结果: ${finalQuestions.length} 题`);
console.log(`    题型: 单选 ${stats.single} / 多选 ${stats.multiple} / 判断 ${stats.judge} / 填空 ${stats.fill} / 简答 ${stats.short}`);
console.log(`    难度: 简单 ${diffStats.easy} / 中等 ${diffStats.medium} / 困难 ${diffStats.hard}`);
console.log(`    章节: ${finalChapters.map((c) => `${c.name}(${byChapter.get(c.id)?.length || 0})`).join('  ')}`);

if (warnings.length) {
  console.log(`\n  提醒 ${warnings.length} 条：`);
  [...new Set(warnings)].slice(0, 15).forEach((w) => console.log(`    ! ${w}`));
  if (warnings.length > 15) console.log(`    ... 还有 ${warnings.length - 15} 条`);
}

if (dryRun) {
  console.log('\n  --dry-run：未写入文件\n');
  process.exit(0);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, output, 'utf8');

console.log(`\n  已写入: ${path.relative(ROOT, outPath)}（${(output.length / 1024).toFixed(1)} KB）`);
console.log('  下一步: node scripts/check.mjs   然后刷新页面查看效果\n');
