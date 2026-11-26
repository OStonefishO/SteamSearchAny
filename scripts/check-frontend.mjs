// 交叉检查：app.js 里引用的 #id / data 属性是否在 index.html / style.css 里存在
import fs from 'node:fs';

const html = fs.readFileSync('public/index.html', 'utf8');
const js = fs.readFileSync('public/app.js', 'utf8');
const css = fs.readFileSync('public/style.css', 'utf8');

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const jsIds = new Set([...js.matchAll(/\$\(\s*'#([a-zA-Z0-9_-]+)'/g)].map((m) => m[1]));

const missing = [...jsIds].filter((id) => !htmlIds.has(id));
console.log('JS 引用的 id 数:', jsIds.size);
console.log('HTML 定义的 id 数:', htmlIds.size);
console.log('缺失的 id:', missing.length ? missing.join(', ') : '无 ✅');

// 动态创建的 id（由 JS 注入）不算缺失
const dynamic = ['rollAgain', 'heroDetail', 'heroSimilar', 'modalSeed'];
const realMissing = missing.filter((m) => !dynamic.includes(m));
console.log('真正缺失:', realMissing.length ? realMissing.join(', ') : '无 ✅');

// class 检查：JS 里用到的 class 是否在 CSS 中定义
const cssClasses = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
const jsClasses = new Set([...js.matchAll(/class="([^"$]*?)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
const undefinedClasses = [...jsClasses].filter((c) => !cssClasses.has(c));
console.log('JS 用到但 CSS 未定义的 class:', undefinedClasses.length ? undefinedClasses.join(', ') : '无 ✅');

// data-* 属性检查
for (const attr of ['data-view', 'data-mode', 'data-tag', 'data-weight', 'data-rm', 'data-act', 'data-id']) {
  const inHtml = html.includes(attr) || js.includes(attr);
  console.log(`${attr}: ${inHtml ? 'ok' : '缺失 ⚠️'}`);
}
