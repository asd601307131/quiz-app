/**
 * 从《题型及考情分析》抽取文字版里解析出历年真题，生成题库 CSV。
 *
 *   node scripts/parse-politics.mjs
 *
 * 输出:
 *   work/成考题库-政治.csv        可直接用 import-questions.mjs 导入
 *   work/parse-report.txt         抽取报告（哪些题被跳过、为什么）
 *
 * 原文结构（PDF 抽出的文字）:
 *   【历年真题】
 *   1.题干（ ）
 *   A.选项  B.选项  C.选项  D.选项
 *   ...
 *   【答案】
 *   1.B.解析文字
 *   2.A.解析文字
 *   或主观题:
 *   1.解析
 *   (1)...（2分）
 *
 * 章节按原文的「考点」归属自动归类。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'work', 'pdf-text', '专升本_理工类_题型及考情分析.txt');
const OUT_CSV = path.join(ROOT, 'work', '成考题库-政治.csv');
const OUT_REPORT = path.join(ROOT, 'work', 'parse-report.txt');
const OUT_CHAPTERS = path.join(ROOT, 'work', '成考章节.csv');

if (!fs.existsSync(SRC)) {
  console.error(`找不到源文本: ${SRC}\n请先运行: python tools/extract-pdf.py "D:\\Users\\24969\\Desktop\\理工类复习资料"`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 文本预处理                                                          */
/* ------------------------------------------------------------------ */

const rawLines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);

/** 清理页眉页脚等噪声，返回 { line, no } 数组 */
const lines = [];
rawLines.forEach((text, i) => {
  const line = text.trim();
  if (!line) return;
  if (/^=+ 第 \d+ 页 =+$/.test(line)) return;
  if (line === '政治、英语、高等数学') return;
  if (/^\d{1,3}$/.test(line)) return; // 页码
  if (line.includes('内部资料，禁止印刷销售')) return;
  lines.push({ line, no: i + 1 });
});

/** 政治正文范围：从「专升本政治科目」到「专升本英语科目」 */
const politicsStart = lines.findIndex((l) => l.line.includes('专升本政治科目'));
const englishStart = lines.findIndex((l) => l.line.includes('专升本英语科目'));
const POLITICS_END = englishStart > 0 ? englishStart : lines.length;

/* ------------------------------------------------------------------ */
/* 章节划分：按原文「考点」                                            */
/* ------------------------------------------------------------------ */

const CHAPTER_DEFS = [
  { id: 'p1-1', part: '第一部分 马克思主义哲学原理', name: '马哲·哲学与世界观', desc: '哲学基本问题、两大派别、马克思主义哲学的产生与特征', icon: '🧭' },
  { id: 'p1-2', part: '第一部分 马克思主义哲学原理', name: '马哲·物质与意识', desc: '物质定义、运动与静止、客观规律与主观能动性', icon: '⚛️' },
  { id: 'p1-3', part: '第一部分 马克思主义哲学原理', name: '马哲·联系与发展', desc: '联系、发展、三大规律（对立统一、量变质变、否定之否定）', icon: '🔗' },
  { id: 'p1-4', part: '第一部分 马克思主义哲学原理', name: '马哲·实践与认识', desc: '实践与认识的辩证关系、真理与检验标准', icon: '🔬' },
  { id: 'p1-5', part: '第一部分 马克思主义哲学原理', name: '马哲·社会存在与结构', desc: '社会存在与社会意识、社会基本结构', icon: '🏛️' },
  { id: 'p1-6', part: '第一部分 马克思主义哲学原理', name: '马哲·社会发展动力', desc: '社会基本矛盾、阶级斗争、人民群众与历史人物', icon: '⚙️' },
  { id: 'p2-1', part: '第二部分 毛泽东思想和中国特色社会主义理论体系概论', name: '毛概·马克思主义中国化', desc: '马克思主义中国化的历史进程与理论成果', icon: '📕' },
  { id: 'p2-2', part: '第二部分 毛泽东思想和中国特色社会主义理论体系概论', name: '毛概·新民主主义革命', desc: '新民主主义革命理论与社会主义改造理论', icon: '🚩' },
  { id: 'p2-3', part: '第二部分 毛泽东思想和中国特色社会主义理论体系概论', name: '毛概·社会主义本质', desc: '社会主义本质与初级阶段理论', icon: '🌱' },
  { id: 'p2-4', part: '第二部分 毛泽东思想和中国特色社会主义理论体系概论', name: '毛概·改革与开放', desc: '社会主义改革和对外开放', icon: '🔓' },
  { id: 'p2-5', part: '第二部分 毛泽东思想和中国特色社会主义理论体系概论', name: '中特·经济建设', desc: '建设中国特色社会主义经济', icon: '📈' },
  { id: 'p2-6', part: '第二部分 毛泽东思想和中国特色社会主义理论体系概论', name: '中特·政治建设', desc: '建设中国特色社会主义政治', icon: '⚖️' },
  { id: 'p2-7', part: '第二部分 毛泽东思想和中国特色社会主义理论体系概论', name: '中特·文化建设', desc: '建设中国特色社会主义文化、社会主义核心价值观', icon: '🎭' },
  { id: 'p2-8', part: '第二部分 毛泽东思想和中国特色社会主义理论体系概论', name: '中特·和谐社会', desc: '构建社会主义和谐社会', icon: '🤝' },
  { id: 'p2-9', part: '第二部分 毛泽东思想和中国特色社会主义理论体系概论', name: '中特·国际战略', desc: '国际战略和外交政策', icon: '🌏' },
  { id: 'p2-10', part: '第二部分 毛泽东思想和中国特色社会主义理论体系概论', name: '中特·一国两制', desc: '“一国两制”与祖国完全统一', icon: '🇨🇳' },
  { id: 'p2-11', part: '第二部分 毛泽东思想和中国特色社会主义理论体系概论', name: '中特·依靠力量与领导核心', desc: '中国特色社会主义事业的依靠力量和领导核心', icon: '⭐' },
  { id: 'subj-bx', part: '主观题专项', name: '辨析题专项', desc: '判断正误并说明理由（每题 10 分，考纲共 2 题）', icon: '⚖️' },
  { id: 'subj-jd', part: '主观题专项', name: '简答与论述专项', desc: '简答 3 题（各 10 分）与论述 1 题（20 分）', icon: '✍️' },
];

/** 考点序号 -> 章节 id */
const EXAM_POINT_TO_CHAPTER = {
  '1-1': 'p1-1', '1-2': 'p1-2', '1-3': 'p1-3', '1-4': 'p1-4', '1-5': 'p1-5', '1-6': 'p1-6',
  '2-1': 'p2-1', '2-2': 'p2-2', '2-3': 'p2-3', '2-4': 'p2-4', '2-5': 'p2-5', '2-6': 'p2-6',
  '2-7': 'p2-7', '2-8': 'p2-8', '2-9': 'p2-9', '2-10': 'p2-10', '2-11': 'p2-11',
};

/**
 * 扫描正文，建立「行号 -> 章节」的映射。
 * 原文顺序：第一部分 考点1..6，第二部分 考点1..11。
 * 注意第二部分第 11 考点之后还有内容（含时政），交给 p3。
 */
const sectionAt = new Array(lines.length).fill(null);
let partIndex = 0;
let pointIndex = 0;
let currentChapter = null;

for (let i = 0; i < POLITICS_END; i += 1) {
  const { line } = lines[i];

  const partMatch = /^第([一二三四])部分/.exec(line);
  if (partMatch) {
    partIndex = { 一: 1, 二: 2, 三: 3, 四: 4 }[partMatch[1]] || partIndex;
    pointIndex = 0;
  }

  const pointMatch = /^考点\s*(\d+)/.exec(line);
  if (pointMatch) {
    pointIndex = Number(pointMatch[1]);
    const key = `${partIndex}-${pointIndex}`;
    currentChapter = EXAM_POINT_TO_CHAPTER[key] || (partIndex === 1 ? 'p1-1' : 'p3');
  }

  sectionAt[i] = currentChapter;
}

/* ------------------------------------------------------------------ */
/* 抽取真题块                                                          */
/* ------------------------------------------------------------------ */

const OPTION_LINE = /^\s*([A-Da-d])[.．、)）]\s*(.+)$/;
const NUM_LINE = /^\s*(\d{1,2})[.．、]\s*(.*)$/;
const ANSWER_HEAD = /^【答案】/;
const QUESTION_HEAD = /^【历年真题】/;

const records = [];
const report = [];

/** 把连续多行合并为一行（PDF 换行会把一句话切断） */
function joinLines(parts) {
  return parts
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\s*([，。；：、？！])\s*/g, '$1')
    .trim();
}

/**
 * 规范化为「单行文本」，用于题干等字段。
 * 保留换行会让 CSV 单元格出现内嵌换行，Excel 与下游解析都容易出错，
 * 因此统一把换行/多空格压成一个空格。
 */
function oneLine(text) {
  return String(text || '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 从某行的行号开始，向后读取一段，直到遇到终止条件 */
function readUntil(startIdx, stopFn) {
  const parts = [];
  let i = startIdx;
  for (; i < lines.length; i += 1) {
    if (stopFn(lines[i].line, i)) break;
    parts.push(lines[i].line);
  }
  return { text: joinLines(parts), endIdx: i };
}

for (let i = 0; i < POLITICS_END; i += 1) {
  if (!QUESTION_HEAD.test(lines[i].line)) continue;

  const blockStartLine = lines[i].no;
  // 找到该块对应的【答案】；若中途先遇到下一个【历年真题】，说明本块没有答案
  let answerIdx = -1;
  for (let j = i + 1; j < POLITICS_END; j += 1) {
    if (QUESTION_HEAD.test(lines[j].line)) break;
    if (ANSWER_HEAD.test(lines[j].line)) {
      answerIdx = j;
      break;
    }
  }
  if (answerIdx < 0) {
    report.push(`第 ${blockStartLine} 行的【历年真题】没有紧随其后的【答案】，整块跳过`);
    continue;
  }

  // 下一个真题块或答案块作为答案区结束
  let answerEnd = POLITICS_END;
  for (let j = answerIdx + 1; j < POLITICS_END; j += 1) {
    if (QUESTION_HEAD.test(lines[j].line)) {
      answerEnd = j;
      break;
    }
  }

  const chapter = sectionAt[i] || 'p3';

  /* ---- 1) 解析答案区，建立 题号 -> { 字母, 解析 } ----
   *
   * 注意：答案区里往往会再重复一遍题目原文（含选项），
   * 所以不能「遇到数字开头的行就当成新答案」，否则题干行会覆盖掉答案字母。
   * 这里按「答案锚点行」切段：锚点 = 数字开头且（紧跟答案字母 或 内容是解析文字）。
   */
  const isQuestionStemLine = (text) => /[（(]\s*[）)]\s*$/.test(text);

  const anchorIdx = []; // 答案锚点所在的下标
  for (let j = answerIdx + 1; j < answerEnd; j += 1) {
    const line = lines[j].line;
    if (ANSWER_HEAD.test(line)) continue;

    const withLetter = /^(\d{1,2})\s*[.．、]\s*([A-Da-d])\s*[.．、)）]?\s*(.*)$/.exec(line);
    if (withLetter) {
      anchorIdx.push(j);
      continue;
    }

    const plain = /^(\d{1,2})\s*[.．、]\s*(.*)$/.exec(line);
    if (!plain) continue;
    // 数字开头但没有答案字母：题干行（以（ ）结尾）不算锚点，其余算（主观题解析）
    if (isQuestionStemLine(line)) continue;
    anchorIdx.push(j);
  }

  const answerMap = new Map();
  anchorIdx.forEach((start, k) => {
    const end = k + 1 < anchorIdx.length ? anchorIdx[k + 1] : answerEnd;
    const head = lines[start].line;

    const withLetter = /^(\d{1,2})\s*[.．、]\s*([A-Da-d])\s*[.．、)）]?\s*(.*)$/.exec(head);
    const plain = /^(\d{1,2})\s*[.．、]\s*(.*)$/.exec(head);
    const no = Number((withLetter || plain)[1]);
    const letter = withLetter ? withLetter[2].toUpperCase() : null;
    const firstRest = ((withLetter ? withLetter[3] : plain[2]) || '').trim();

    const parts = [];
    if (firstRest) parts.push(firstRest);
    for (let j = start + 1; j < end; j += 1) {
      const line = lines[j].line;
      if (ANSWER_HEAD.test(line)) continue;
      parts.push(line);
    }

    answerMap.set(no, { no, letter, parts });
  });

  /**
   * 过滤答案区里的干扰项：
   *  1) 答案区之后常紧跟知识点正文，其中的「7.矛盾的普遍性」这类小标题也带编号 → 内容不含句末标点，丢弃；
   *  2) 没有答案字母、也没有解析文字的编号行 → 丢弃。
   * 注意：带答案字母的条目一律保留，即使解析很短（字母本身就是判分依据）。
   */
  for (const [no, item] of [...answerMap.entries()]) {
    const text = item.parts.join('').trim();
    if (item.letter) {
      if (!text && !/[。！？；]/.test(text)) {
        // 有字母但解析为空：保留字母，解析留空由下游兜底
        item.parts = [];
      }
      continue;
    }
    // 无字母：必须是像样的解析文字，否则视为知识点标题/空行
    if (!text || !/[。！？；]/.test(text)) answerMap.delete(no);
  }

  // 再按编号连续性收敛：丢掉断号之后的内容
  let expect = 1;
  for (const no of [...answerMap.keys()].sort((a, b) => a - b)) {
    if (no === expect) expect += 1;
    else if (no > expect) answerMap.delete(no);
  }

  /* ---- 2) 解析题目区 ---- */
  const questions = [];
  let q = null;
  let optionLines = 0;
  for (let j = i + 1; j < answerIdx; j += 1) {
    const line = lines[j].line;
    const m = NUM_LINE.exec(line);

    // 选项行：追加到当前题的选项
    const om = OPTION_LINE.exec(line);
    if (om && q && q.options.length < 4 && om[1].toUpperCase() === 'ABCD'[q.options.length]) {
      q.options.push(om[2].trim());
      optionLines += 1;
      continue;
    }

    // 新题号
    if (m) {
      if (q) questions.push(q);
      q = { no: Number(m[1]), stemParts: m[2] ? [m[2]] : [], options: [] };
      continue;
    }

    // 其他行：题干续行
    if (q) q.stemParts.push(line);
  }
  if (q) questions.push(q);

  report.push(
    `块(行${blockStartLine}) 题 ${questions.length} 道 / 答案 ${answerMap.size} 条 / 选项行 ${optionLines} 行`
  );

  if (process.env.PARSE_DEBUG && blockStartLine === Number(process.env.PARSE_DEBUG_BLOCK || 231)) {
    console.log(`\n[DEBUG] 块原始行=${blockStartLine} 答案区=${lines[answerIdx].no}~${lines[answerEnd] ? lines[answerEnd].no : 'EOF'} 锚点=${anchorIdx.length}`);
    for (const [no, v] of [...answerMap.entries()].slice(0, 8)) {
      console.log(`  no=${no} letter=${v.letter} 解析前40字=${(v.parts.join('') || '').slice(0, 40)}`);
    }
    console.log(`  题目: ${questions.map((x) => `no${x.no}/选项${x.options.length}`).join(' ')}\n`);
  }

  /* ---- 3) 合并成记录 ---- */
  for (const item of questions) {
    const stem = joinLines(item.stemParts).replace(/[（(]\s*[）)]\s*$/, '').trim();
    const ans = answerMap.get(item.no);
    const analysis = ans ? joinLines(ans.parts) : '';

    if (!stem) {
      report.push(`第 ${blockStartLine} 行块：第 ${item.no} 题题干为空，跳过`);
      continue;
    }
    if (!ans) {
      report.push(`块(行${blockStartLine}) 第 ${item.no} 题缺少答案，跳过：${stem.slice(0, 30)}`);
      continue;
    }

    const isChoice = item.options.length >= 2;

    /**
     * 变形题防线：有些选择题的选项在 PDF 里被并进了题干
     * （例如「……是党领导人民治理国家的（ ）C.基本纲领 D.基本纲要」），
     * 这种题既没有独立选项、答案也不是主观题解析，直接跳过而不是误当简答题。
     */
    const mergedOptions = (stem.match(/[A-D]\s*[.．、]\s*\S/g) || []).length;
    if (!isChoice && (mergedOptions >= 2 || (/[（(]\s*[）)]/.test(stem) && mergedOptions >= 1))) {
      report.push(`块(行${blockStartLine}) 第 ${item.no} 题选项被并进题干，无法可靠还原，跳过：${stem.slice(0, 40)}`);
      continue;
    }

    if (isChoice) {
      if (!ans.letter) {
        report.push(`块(行${blockStartLine}) 第 ${item.no} 题为选择题但答案里没有字母，跳过：${stem.slice(0, 30)}`);
        continue;
      }
      if (item.options.length < 4) {
        report.push(`块(行${blockStartLine}) 第 ${item.no} 题只解析到 ${item.options.length} 个选项，仍按现有选项保留`);
      }
      records.push({
        chapterId: chapter,
        type: 'single',
        stem,
        options: item.options,
        answer: ans.letter,
        analysis: analysis || '（见知识点汇总）',
      });
    } else {
      // 主观题：先看是不是辨析题（答案以「错误。」「正确。」开头）
      const bx = /^\s*(错误|正确|这种说法错误|这种说法正确|不对|对)\s*[。．.，,、]?\s*(?:\(?\s*\d+\s*分\s*\)?)?\s*([\s\S]*)$/.exec(
        analysis
      );

      if (bx) {
        // 辨析题拆成两道，对应考试的两步作答：先判正误，再说明理由
        const isRight = /^(正确|对|这种说法正确)/.test(bx[1]);
        const reason = bx[2] ? joinLines([bx[2]]) : analysis;

        records.push({
          chapterId: 'subj-bx',
          type: 'judge',
          stem: `【辨析】${stem}`,
          answer: isRight ? 'A' : 'B',
          analysis: `参考答案：该说法${isRight ? '正确' : '错误'}。${reason}`,
        });
        records.push({
          chapterId: 'subj-bx',
          type: 'short',
          stem: oneLine(`【辨析理由】${stem} ｜ 请说明理由：该说法为什么${isRight ? '正确' : '错误'}？`),
          answerText: reason,
          analysis: '踩点给分：先明确判断正误，再分点说明理由。',
        });
      } else {
        records.push({
          chapterId: 'subj-jd',
          type: 'short',
          stem,
          answerText: analysis || '（参考答案见知识点汇总）',
          analysis: '按要点作答，踩点给分。',
        });
      }
    }
  }

  void answerEnd;
}

/* ------------------------------------------------------------------ */
/* 去重与输出                                                          */
/* ------------------------------------------------------------------ */

const seen = new Set();
const unique = [];
for (const r of records) {
  const key = r.stem.replace(/\s/g, '');
  if (seen.has(key)) {
    report.push(`重复题目已去重：${r.stem.slice(0, 30)}`);
    continue;
  }
  seen.add(key);
  unique.push(r);
}

/** 生成 id 与难度 */
const byChapterCount = new Map();
unique.forEach((r, idx) => {
  const n = (byChapterCount.get(r.chapterId) || 0) + 1;
  byChapterCount.set(r.chapterId, n);
  r.id = `${r.chapterId}-${String(n).padStart(3, '0')}`;
  r.difficulty = r.type === 'short' ? 'hard' : idx % 10 < 4 ? 'easy' : idx % 10 < 8 ? 'medium' : 'hard';
});

/* ---- CSV ---- */

function csvCell(v) {
  const t = v == null ? '' : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const HEADERS = ['id', 'chapterId', 'difficulty', 'type', 'stem', 'optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'answer', 'answerText', 'analysis', 'tags'];

/** 内部题型 -> CSV 题型列（必须与 import-questions.mjs 的别名表一致） */
const CSVTYPE = { single: '单选', multiple: '多选', judge: '判断', fill: '填空', short: '简答' };

const csvRows = unique.map((r) => {
  const opts = r.options || [];
  const row = {
    id: r.id,
    chapterId: r.chapterId,
    difficulty: r.difficulty,
    type: CSVTYPE[r.type] || '单选',
    stem: oneLine(r.stem),
    optionA: oneLine(opts[0] || ''),
    optionB: oneLine(opts[1] || ''),
    optionC: oneLine(opts[2] || ''),
    optionD: oneLine(opts[3] || ''),
    optionE: oneLine(opts[4] || ''),
    answer: r.answer || '',
    answerText: oneLine(r.answerText || ''),
    analysis: oneLine(r.analysis),
    tags: '历年真题',
  };
  return HEADERS.map((h) => csvCell(row[h])).join(',');
});

fs.mkdirSync(path.dirname(OUT_CSV), { recursive: true });
fs.writeFileSync(OUT_CSV, `\uFEFF${HEADERS.join(',')}\r\n${csvRows.join('\r\n')}\r\n`, 'utf8');

/* ---- 章节表 ---- */

const usedChapters = new Set(unique.map((r) => r.chapterId));
const chapterRows = CHAPTER_DEFS.filter((c) => usedChapters.has(c.id));
fs.writeFileSync(
  OUT_CHAPTERS,
  `\uFEFF${['id,name,desc,icon'].join(',')}\r\n${chapterRows
    .map((c) => [c.id, c.name, c.desc, c.icon].map(csvCell).join(','))
    .join('\r\n')}\r\n`,
  'utf8'
);

/* ---- 报告 ---- */

const choiceCount = unique.filter((r) => r.type === 'single').length;
const shortCount = unique.filter((r) => r.type === 'short').length;

const reportLines = [
  `源文件: ${path.relative(ROOT, SRC)}`,
  `抽取时间: ${new Date().toLocaleString('zh-CN')}`,
  '',
  `题目总数: ${unique.length}（单选 ${choiceCount} / 简答与论述 ${shortCount}）`,
  `章节分布:`,
  ...[...byChapterCount.entries()].map(([id, n]) => {
    const def = CHAPTER_DEFS.find((c) => c.id === id);
    return `  ${id.padEnd(6)} ${String(n).padStart(3)} 题  ${def ? def.name : '(未命名)'}`;
  }),
  '',
  `跳过/提醒 ${report.length} 条:`,
  ...report.map((r) => `  - ${r}`),
  '',
];

fs.writeFileSync(OUT_REPORT, reportLines.join('\n'), 'utf8');

console.log(`\n  抽取完成`);
console.log(`    单选 ${choiceCount} 题 / 简答论述 ${shortCount} 题，共 ${unique.length} 题`);
console.log(`    章节 ${byChapterCount.size} 个`);
console.log(`\n  题库 CSV: ${path.relative(ROOT, OUT_CSV)}`);
console.log(`  章节 CSV: ${path.relative(ROOT, OUT_CHAPTERS)}`);
console.log(`  报告:     ${path.relative(ROOT, OUT_REPORT)}（跳过 ${report.length} 条）\n`);
