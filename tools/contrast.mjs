/**
 * 深色模式配色对比度计算：找出满足 WCAG AA（4.5:1）的候选色。
 *   node work\contrast.mjs
 */
const lum = ({ r, g, b }) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const hex = (h) => {
  const s = h.replace('#', '');
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
};
const ratio = (a, b) => {
  const l1 = lum(hex(a)); const l2 = lum(hex(b));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

const bgCard = process.argv[2] || '#1a2030';
const bgPage = process.argv[3] || '#10141d';

const candidates = [
  '#78829a', '#8089a0', '#8a93a9', '#949cb0', '#9aa3b8',
  '#a0a9bd', '#a8b1c4', '#b0b9cc', '#bcc4d4', '#c4cde0',
];

console.log(`\n深色模式候选色对比度（卡片 ${bgCard} / 页面 ${bgPage}）\n`);
console.log('  色值        卡片上    页面上    结论');
for (const c of candidates) {
  const rCard = ratio(c, bgCard);
  const rPage = ratio(c, bgPage);
  const ok = rCard >= 4.5 && rPage >= 4.5 ? '✓ 可用于小字' : '✗ 不足';
  console.log(`  ${c}   ${rCard.toFixed(2).padStart(5)}   ${rPage.toFixed(2).padStart(6)}    ${ok}`);
}

console.log('\n正文与强调色检查：');
for (const [name, color] of [['--c-text', '#e8ecf5'], ['--c-text-2', '#a8b1c4'], ['--c-primary', '#6b93ff'], ['--c-green', '#4ade80'], ['--c-orange', '#f0b354'], ['--c-red', '#ff6b70']]) {
  console.log(`  ${name.padEnd(14)} ${color}  卡片 ${ratio(color, bgCard).toFixed(2)}  页面 ${ratio(color, bgPage).toFixed(2)}`);
}
console.log('');
