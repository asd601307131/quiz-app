/**
 * 参考答案要点提取。
 *
 * 成考政治主观题的参考答案都是「踩点给分」，原文通常是：
 *   (1)xxx；(2)yyy；①zzz；第一，……；一是……
 * 把这些要点抽出来单独展示，手机上更容易背，也更贴近阅卷逻辑。
 *
 * 纯函数，无副作用，供导入脚本与前端复用。
 */

/**
 * 匹配「行首或句末标点之后的要点标记」，整体作为切分依据。
 * 注意不要把中文句号误判成「1.」这种阿拉伯数字编号——
 * 因此数字编号只认行首或分号之后，且编号后必须紧跟非标点内容。
 */
/**
 * 匹配「边界 + 要点标记」，整体作为切分依据。
 * 约束条件（都是为了不被正文标点误触发）：
 *  - 括号编号与圆圈数字后面必须紧跟正文文字，不能是标点或结尾；
 *  - 数字编号不认中文句号，避免把「……的矛盾。」当成「1.」式编号；
 *  - 「第X，」式后面同样必须紧跟文字。
 */
const MARKER_AT_BOUNDARY =
  /(?:^|[。；;！!？?：:，,、\s])(?:[（(]\s*\d{1,2}\s*[）)](?=[^\s。；;！!？?：:，,、])|[①②③④⑤⑥⑦⑧⑨⑩](?=[^\s。；;！!？?：:，,、])|第[一二三四五六七八九十]{1,3}[，,、](?=[^\s。；;！!？?：:，,、])|\d{1,2}\s*[.、](?!\s*[。；;，,、]))/g;

/**
 * 按要点标记切分文本。
 * 以「标记结束位置」为切点，前一段保留句末标点，后一段从标记之后的正文开始。
 * 返回的每段形如：「1）社会存在决定社会意识……」，交给 stripMarker 清掉编号。
 */
function splitByMarkers(text) {
  const cuts = [];
  const re = new RegExp(MARKER_AT_BOUNDARY.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const markerLen = m[0].replace(/^[。；;！!？?\s]/, '').length;
    const cut = m.index + m[0].length;
    cuts.push({ head: cut - markerLen, tail: cut });
    // 防止零宽匹配导致死循环
    if (m[0].length === 0) re.lastIndex += 1;
  }
  if (cuts.length < 2) return [];

  const out = [];
  // 第一个标记之前若有正文，单独作为一段（不当作要点）
  const lead = text.slice(0, cuts[0].head).trim();
  if (lead) out.push({ text: lead, isLead: true });

  for (let i = 0; i < cuts.length; i += 1) {
    const start = cuts[i].head;
    const end = i + 1 < cuts.length ? cuts[i + 1].head : text.length;
    const chunk = text.slice(start, end).trim();
    if (!chunk) continue;
    // 最后一段如果不是以标记开头，说明它是收尾的普通文字，不当作要点
    const isLast = i === cuts.length - 1;
    const startsWithMarker = /^[（(]\s*\d{1,2}\s*[）)]|^[①②③④⑤⑥⑦⑧⑨⑩]|^第[一二三四五六七八九十]{1,3}[，,、]|^\d{1,2}\s*[.、]/.test(chunk);
    if (isLast && !startsWithMarker && i > 0) {
      out.push({ text: chunk, isTail: true });
      continue;
    }
    out.push({ text: chunk, isLead: false });
  }
  return out;
}

/** 去掉要点开头的编号标记与残留标点 */
function stripMarker(point) {
  return point
    .replace(/^[（(]\s*\d{1,2}\s*[）)]\s*/, '')
    .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '')
    .replace(/^第[一二三四五六七八九十]+[，,、]\s*/, '')
    .replace(/^\d{1,2}\s*[.、]\s*/, '')
    // 只清理 ASCII 标点与全角冒号残留；不碰全角括号——"（1）"必须留给上面那条规则处理
    .replace(/^[;:,.\s：]+/, '')
    .trim();
}

/** 判断一个要点是否「像话」（避免把半句话当要点） */
function looksLikePoint(text) {
  if (!text) return false;
  if (text.length < 6) return false;
  // 至少要有中文内容
  if (!/[\u4e00-\u9fa5]/.test(text)) return false;
  return true;
}

/**
 * 从参考答案文本中提取要点。
 * @param {string} text 参考答案
 * @returns {string[]} 要点数组；无法拆分时返回空数组
 */
export function extractPoints(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  // 去掉开头的「参考答案：」等前缀
  const body = raw.replace(/^(【?参考答案】?|答案)\s*[:：]?\s*/, '').trim();

  // 太短的不拆（例如判断题的一句话结论）
  if (body.length < 40) return [];

  const segments = splitByMarkers(body);
  if (segments.length < 2) return [];

  const points = segments
    .filter((s) => !s.isLead)
    .map((s) => stripMarker(s.text))
    .filter(looksLikePoint);

  // 至少要有 2 个像样的要点，否则认为拆分失败
  if (points.length < 2) return [];

  // 单点过长（说明标记识别有误，把整段吞进来了）则放弃
  const tooLong = points.filter((p) => p.length > 400);
  if (tooLong.length > points.length / 2) return [];

  return points;
}

/**
 * 需要拆要点的题型。
 * 判定依据是题型而非数据来源——教材真题与陕西真题都要拆。
 */
export function shouldExtractPoints(type) {
  return type === 'short' || type === 'judge' || type === 'fill';
}
