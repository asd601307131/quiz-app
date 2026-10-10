/**
 * 题库质量校验：检查一批 CSV 题库文件是否存在常见质量问题。
 *
 *   node tools/audit-bank.mjs work/成考题库-政治.csv work/variants-哲学.csv ...
 *   node tools/audit-bank.mjs work/variants-*.csv --sample 5      # 抽样人工复核
 *
 * 检查项：
 *   1. 单文件内与跨文件的题干重复（完全重复 / 高相似重复）
 *   2. 选项重复（同一题两个选项文字一样）
 *   3. 选项空值、答案越界、题型与字段不匹配
 *   4. 答案分布是否过度集中（例如一半都是 B）
 *   5. 解析缺失或过短
 *   6. 题干过短、疑似截断
 *   7. 「下列说法错误的是」类反向题是否明确
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const sampleIdx = args.indexOf('--sample');
const sampleCount = sampleIdx >= 0 ? Number(args[sampleIdx + 1] || 3) : 0;
// 注意：sampleIdx 为 -1 时不能写成 i !== sampleIdx + 1，否则会把第一个文件参数过滤掉
const files = args.filter((a, i) => !a.startsWith('--') && !(sampleIdx >= 0 && i === sampleIdx + 1));

if (!files.length) {
  console.error('用法: node tools/audit-bank.mjs <csv...> [--sample N]');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* CSV 读取                                                            */
/* ------------------------------------------------------------------ */

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

/** 读取一个 CSV（支持引号内换行） */
function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const rows = [];
  let cur = '';
  let inQuotes = false;
  const physical = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === '\n' && !inQuotes) {
      physical.push(cur);
      cur = '';
    } else if (ch !== '\r') {
      cur += ch;
    }
  }
  if (cur) physical.push(cur);

  const lines = physical.filter((l) => l.trim() !== '');
  const rawHeader = splitCsvLine(lines[0]).map((h) => h.trim());
  const header = rawHeader.map((h) => h.toLowerCase());

  /** 大小写不敏感取值：CSV 表头可能是 chapterId / chapterid / ChapterID */
  const pick = (obj, name) => {
    if (obj[name] != null) return obj[name];
    const lower = name.toLowerCase();
    for (const key of Object.keys(obj)) {
      if (key.toLowerCase() === lower) return obj[key];
    }
    return '';
  };

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const raw = {};
    rawHeader.forEach((h, i) => { raw[h] = cells[i] == null ? '' : String(cells[i]).trim(); });
    // 统一成小写键，后续所有读取都走 pick()，避免驼峰/大小写不匹配
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i] == null ? '' : String(cells[i]).trim(); });
    rows.push({ ...obj, __get: (name) => pick(raw, name) });
  }
  return { header: rawHeader, rows };
}

/* ------------------------------------------------------------------ */
/* 检查                                                                */
/* ------------------------------------------------------------------ */

const ANSWER_FIELDS = ['answer'];
const all = [];
const problems = [];
const warnings = [];

function addProblem(file, id, msg) { problems.push({ file, id, msg }); }
function addWarning(file, id, msg) { warnings.push({ file, id, msg }); }

/** 归一化题干用于去重比较 */
function normStem(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/[，。、；：？！,.;:?!'"“”‘’（）()《》【】\[\]]/g, '')
    .toLowerCase();
}

/** 粗粒度相似度：字符二元组 Jaccard */
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter += 1;
  return inter / (ga.size + gb.size - inter);
}

for (const file of files) {
  if (!fs.existsSync(file)) {
    addProblem(file, '-', '文件不存在');
    continue;
  }
  const { header, rows } = readCsv(file);
  if (process.env.AUDIT_DEBUG) {
    console.log(`[DEBUG] ${path.basename(file)} 表头(${header.length}): ${header.join(' | ')}`);
    if (rows[0]) {
      console.log(`[DEBUG] 首行键(${Object.keys(rows[0]).length}): ${Object.keys(rows[0]).join(' | ')}`);
      console.log(`[DEBUG] 首行值: ${JSON.stringify(rows[0]).slice(0, 240)}`);
    }
  }

  rows.forEach((r) => {
    const g = (name) => (typeof r.__get === 'function' ? r.__get(name) : (r[name] || ''));
    const id = g('id') || '(无 id)';
    const type = g('type');
    const isChoice = /单选|多选/.test(type);
    const isJudge = /判断/.test(type);
    const isFill = /填空/.test(type);
    // 论述也是主观题，必须一并识别，否则会误报「题型无法识别」
    const isShort = /简答|问答|论述/.test(type);

    // 必填字段
    if (!g('id')) addProblem(file, id, '缺少 id');
    if (!g('chapterId')) addProblem(file, id, '缺少 chapterId');
    const stem = g('stem');
    if (!stem || stem.length < 6) addProblem(file, id, `题干过短或为空：「${stem.slice(0, 20)}」`);
    /**
     * 题干疑似截断。
     * 大量合法题干本身就靠选项补完（「……表现在」「……这是因为」「……可以区分为」
     * 「……是我们党的」「……达到」），因此这类结尾一律不报，避免误报淹没真问题。
     * 只报两种确定可疑的情况：题干本身过短，或以标点收尾。
     */
    if (stem && /[，,、；;：:]$/.test(stem)) {
      addProblem(file, id, `题干以标点结尾，疑似截断：「…${stem.slice(-14)}」`);
    }
    const difficulty = g('difficulty');
    if (!/简单|中等|困难|easy|medium|hard/i.test(difficulty)) addWarning(file, id, `难度写法异常：「${difficulty}」`);
    const analysis = g('analysis');
    if (!analysis || analysis.length < 8) addWarning(file, id, `解析过短：「${analysis.slice(0, 20)}」`);

    // 题型专项
    // 注意：缺列的行会补出 undefined，这里统一规范成字符串再过滤
    const options = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE']
      .map((k) => g(k))
      .filter((v) => v !== '');

    const answer = g('answer');
    const answerText = g('answerText');

    if (isChoice) {
      if (options.length < 2) addProblem(file, id, `选项不足（${options.length} 个）`);
      if (!/^[A-E]$/.test(answer || '')) addProblem(file, id, `答案非法：「${answer}」`);
      // 选项重复
      const seen = new Map();
      options.forEach((o) => seen.set(o, (seen.get(o) || 0) + 1));
      for (const [text, n] of seen) {
        if (n > 1) addProblem(file, id, `选项重复出现 ${n} 次：「${text.slice(0, 20)}」`);
      }
      // 答案越界
      const idx = (answer || '').charCodeAt(0) - 65;
      if (idx >= 0 && idx >= options.length) {
        addProblem(file, id, `答案 ${answer} 超出选项范围（${options.length} 个选项）`);
      }
      // 反向题检查
      if (/错误|不属于|不正确|不包括|无关/.test(stem) && !/的(是|为)|下列|以下/.test(stem)) {
        addWarning(file, id, '疑似反向题但表述不够明确，建议写成「下列说法错误的是」');
      }
    } else if (isJudge) {
      if (!/^[AB]$/.test(answer || '')) addProblem(file, id, `判断题答案应为 A/B，实际「${answer}」`);
    } else if (isFill) {
      if (!answer) addProblem(file, id, '填空题缺少答案');
    } else if (isShort) {
      if (!answerText) addProblem(file, id, '简答题缺少 answerText 参考答案');
    } else {
      addProblem(file, id, `题型无法识别：「${type}」`);
    }

    all.push({ file, id, chapterId: g('chapterId'), type, answer, answerText, analysis, difficulty, stem, __options: options, __norm: normStem(stem) });
  });
}

/* ---- 重复检测 ---- */
const byStem = new Map();
for (const q of all) {
  if (!q.__norm) continue;
  if (!byStem.has(q.__norm)) byStem.set(q.__norm, []);
  byStem.get(q.__norm).push(q);
}
for (const [norm, list] of byStem) {
  if (list.length > 1) {
    const where = list.map((q) => `${path.basename(q.file)}:${q.id}`).join(', ');
    addProblem(list[0].file, list[0].id, `题干完全重复（${list.length} 处）：${where}`);
  }
}

// 高相似（同一文件内两两比较，只报相似度 >= 0.85 的）
const byFile = new Map();
for (const q of all) {
  if (!byFile.has(q.file)) byFile.set(q.file, []);
  byFile.get(q.file).push(q);
}
for (const [file, list] of byFile) {
  const reported = new Set();
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const key = `${list[i].id}|${list[j].id}`;
      if (reported.has(key)) continue;
      const sim = similarity(list[i].__norm, list[j].__norm);
      if (sim >= 0.85) {
        reported.add(key);
        addWarning(file, list[i].id, `与 ${list[j].id} 高度相似（${(sim * 100).toFixed(0)}%）：${list[i].stem.slice(0, 26)}`);
      }
    }
  }
}

/* ---- 统计 ---- */
const total = all.length;
const answerDist = {};
const typeDist = {};
const chapterDist = {};
for (const q of all) {
  if (/^[A-D]$/.test(q.answer || '')) answerDist[q.answer] = (answerDist[q.answer] || 0) + 1;
  typeDist[q.type] = (typeDist[q.type] || 0) + 1;
  chapterDist[q.chapterId] = (chapterDist[q.chapterId] || 0) + 1;
}

const choiceTotal = Object.entries(answerDist).reduce((a, [, n]) => a + n, 0);

/* ---- 幻觉检测：解析里引用的书名/提法是否真的在教材原文里 ---- */
const SOURCE_FILES = [
  'work/pdf-text/专升本_政治知识点汇总.txt',
  'work/pdf-text/专升本_理工类_题型及考情分析.txt',
];
let sourceCompact = '';
for (const f of SOURCE_FILES) {
  if (fs.existsSync(f)) sourceCompact += fs.readFileSync(f, 'utf8').replace(/\s+/g, '');
}

/** 提取解析里像「专有表述」的片段：书名号与引号内容，最容易出现编造 */
function extractQuotedClaims(analysis) {
  const claims = new Set();
  for (const re of [/《([^》]{2,40})》/g, /[「“]([^」”]{4,40})[」”]/g]) {
    let m;
    while ((m = re.exec(analysis)) !== null) claims.add(m[1].replace(/\s/g, ''));
  }
  return [...claims];
}

if (sourceCompact.length > 1000) {
  for (const q of all) {
    for (const claim of extractQuotedClaims(q.analysis || '')) {
      if (claim.length >= 4 && !sourceCompact.includes(claim)) {
        addWarning(q.file, q.id, `解析中引用的「${claim}」未在教材原文出现，请人工确认是否为编造`);
      }
    }
  }
}

const distProblems = [];
if (choiceTotal >= 20) {
  for (const [letter, n] of Object.entries(answerDist)) {
    const ratio = n / choiceTotal;
    if (ratio > 0.4) distProblems.push(`${letter} 占 ${(ratio * 100).toFixed(0)}%（${n}/${choiceTotal}）偏多`);
    if (ratio < 0.1) distProblems.push(`${letter} 仅占 ${(ratio * 100).toFixed(0)}%（${n}/${choiceTotal}）偏少`);
  }
}

/* ---- 输出 ---- */
console.log('\n════════ 题库质量校验 ════════\n');
console.log(`文件: ${files.map((f) => path.basename(f)).join(', ')}`);
console.log(`题目总数: ${total}`);
console.log(`题型分布: ${JSON.stringify(typeDist)}`);
console.log(`答案分布(选项题 ${choiceTotal} 道): ${JSON.stringify(answerDist)}`);
if (choiceTotal >= 20) {
  Object.entries(answerDist).forEach(([k, v]) => {
    const pct = ((v / choiceTotal) * 100).toFixed(0);
    const bar = '█'.repeat(Math.round(v / choiceTotal * 30));
    console.log(`   ${k} ${String(v).padStart(3)}  ${String(pct).padStart(3)}%  ${bar}`);
  });
}
console.log(`章节分布: ${Object.keys(chapterDist).length} 个章节`);
Object.entries(chapterDist)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`   ${k.padEnd(16)} ${String(v).padStart(3)} 题`));

if (distProblems.length) {
  console.log('\n⚠ 答案分布问题:');
  distProblems.forEach((d) => console.log(`   - ${d}`));
}

console.log(`\n──────── 错误 ${problems.length} 项 ────────`);
problems.slice(0, 40).forEach((p) => console.log(`  ✗ [${path.basename(p.file)}:${p.id}] ${p.msg}`));
if (problems.length > 40) console.log(`  ... 还有 ${problems.length - 40} 项`);

console.log(`\n──────── 提醒 ${warnings.length} 项 ────────`);
warnings.slice(0, 25).forEach((p) => console.log(`  ! [${path.basename(p.file)}:${p.id}] ${p.msg}`));
if (warnings.length > 25) console.log(`  ... 还有 ${warnings.length - 25} 项`);

/* ---- 抽样人工复核 ---- */
if (sampleCount > 0) {
  console.log(`\n──────── 抽样复核 ${sampleCount} 题（答案已标注） ────────\n`);
  const step = Math.max(1, Math.floor(all.length / sampleCount));
  for (let i = 0; i < all.length && i / step < sampleCount; i += step) {
    const q = all[i];
    console.log(`[${path.basename(q.file)}:${q.id}] (${q.chapterId}) ${q.stem}`);
    q.__options.forEach((o, k) => {
      const letter = String.fromCharCode(65 + k);
      console.log(`    ${letter}. ${o}${q.answer === letter ? '   ← 正确答案' : ''}`);
    });
    if (q.answerText) console.log(`    参考答案：${q.answerText.slice(0, 100)}`);
    console.log(`    解析：${(q.analysis || '').slice(0, 110)}`);
    console.log('');
  }
}

console.log(problems.length ? `\n结论：发现 ${problems.length} 个必须修复的问题\n` : '\n结论：未发现阻断性问题\n');
process.exit(problems.length ? 1 : 0);
