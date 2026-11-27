// 补齐：现场页开关、盲盒页开关、事件绑定、请求参数（避开模板字符串插值坑）
import fs from 'node:fs';

const A = 'D:/综合创作/steam-lighthouse/public/app.js';
const H = 'D:/综合创作/steam-lighthouse/public/index.html';
const log = [];
const D = '$'; // 拼出 ${...}，避免本文件被当成模板求值

function patch(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [from, to, label] of pairs) {
    if (!s.includes(from)) {
      log.push('MISS  ' + label);
      continue;
    }
    s = s.replace(from, to);
    log.push('ok    ' + label);
  }
  fs.writeFileSync(file, s, 'utf8');
}

patch(A, [
  // 现场页：读开关
  [
    '  const section = (title, desc, items, opts = {}) => {',
    '  const hideHot = state.hideHot;\n  const section = (title, desc, items, opts = {}) => {',
    '现场：读取开关',
  ],
  // 现场页：过滤
  [
    '      .filter(Boolean);',
    '      .filter(Boolean)\n      .filter((r) => !hideHot || (r.g.rev?.total || 0) < 10000);',
    '现场：过滤热门',
  ],
  // 现场页：插入开关 UI
  [
    '  box.innerHTML = [',
    '  box.innerHTML = `<label class="chk" style="display:inline-flex;margin:2px 0 10px">' +
      '<input type="checkbox" id="hideHotEv" ' +
      '${state.hideHot ? \'checked\' : \'\'}> 不看热门（评测 &gt; 1 万）</label>` + [',
    '现场：插入开关',
  ],
  // 绑定
  [
    "  $('#loadMore').addEventListener('click', () => {",
    "  $('#hideHot')?.addEventListener('change', (e) => {\n" +
      "    state.hideHot = e.target.checked;\n" +
      "    try { localStorage.setItem('lh.hideHot', state.hideHot ? '1' : '0'); } catch {}\n" +
      "    roll();\n" +
      "    if (state.view === 'events') renderEvents();\n" +
      "  });\n" +
      "  try { state.hideHot = localStorage.getItem('lh.hideHot') === '1'; } catch {}\n" +
      "  const hhEl = $('#hideHot');\n" +
      "  if (hhEl) hhEl.checked = Boolean(state.hideHot);\n\n" +
      "  $('#eventsBody')?.addEventListener('change', (e) => {\n" +
      "    if (e.target.id !== 'hideHotEv') return;\n" +
      "    state.hideHot = e.target.checked;\n" +
      "    try { localStorage.setItem('lh.hideHot', state.hideHot ? '1' : '0'); } catch {}\n" +
      "    renderEvents();\n" +
      "  });\n\n" +
      "  $('#loadMore').addEventListener('click', () => {",
    '绑定开关',
  ],
  // 请求参数
  [
    "  if (state.minPct) params.set('minPct', String(state.minPct));",
    "  if (state.hideHot) params.set('maxReviews', '9999');\n  if (state.minPct) params.set('minPct', String(state.minPct));",
    '盲盒：带 maxReviews',
  ],
]);

patch(H, [
  [
    '<label class="date-ctl" title="按发售日期筛选（留空＝不限）">',
    '<label class="chk" title="只显示评测数少于 1 万的冷门作品"><input type="checkbox" id="hideHot"> 不看热门</label>\n      <label class="date-ctl" title="按发售日期筛选（留空＝不限）">',
    '盲盒：加开关',
  ],
]);

console.log(log.join('\n'));
