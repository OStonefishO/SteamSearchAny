// HOT 阈值 5000 → 10000；冷门带宽同步；新增「不看 HOT」开关
import fs from 'node:fs';

const SITE = 'D:/综合创作/steam-lighthouse/public/';
const log = [];
const HOT = 10000;

function patchFile(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [from, to, label, all] of pairs) {
    if (!s.includes(from)) {
      log.push('MISS  ' + file.split('/').pop() + ' :: ' + label);
      continue;
    }
    s = all ? s.split(from).join(to) : s.replace(from, to);
    log.push('ok    ' + file.split('/').pop() + ' :: ' + label);
  }
  fs.writeFileSync(file, s, 'utf8');
}

// ---------- 1. app.js：阈值统一 10000 ----------
patchFile(SITE + 'app.js', [
  ['(g.rev?.total || 0) >= 5000', '(g.rev?.total || 0) >= 10000', '卡片角标阈值', true],
  ['rev.total >= 5000', 'rev.total >= 10000', '主卡阈值', true],
  ['(full.rev?.total || 0) >= 5000', '(full.rev?.total || 0) >= 10000', '详情/资料面板阈值', true],
  // 现场页的「刚上架」里那些 AAA 不再标冷门
  [
    '<span class="card-pill right">冷门 ${g.gem ?? 0}</span>',
    '<span class="card-pill right${(g.rev?.total || 0) >= 10000 ? \' hot\' : \'\'}">${(g.rev?.total || 0) >= 10000 ? \'HOT\' : \'冷门 \' + (g.gem ?? 0)}</span>',
    'eventCard 角标补 HOT',
    true,
  ],
]);

// ---------- 2. local-api.js：冷门带宽按 10K 起算 ----------
patchFile(SITE + 'local-api.js', [
  [
    `if (total <= 120) obscurity = 1;
    else if (total <= 1000) obscurity = 1 - ((total - 120) / 880) * 0.35;
    else if (total <= 5000) obscurity = 0.65 - ((total - 1000) / 4000) * 0.35;
    else if (total <= 20000) obscurity = 0.3 - ((total - 5000) / 15000) * 0.25;
    else obscurity = 0;`,
    `if (total <= 120) obscurity = 1;
    else if (total <= 1000) obscurity = 1 - ((total - 120) / 880) * 0.35;
    else if (total <= 5000) obscurity = 0.65 - ((total - 1000) / 4000) * 0.35;
    else if (total <= 10000) obscurity = 0.3 - ((total - 5000) / 5000) * 0.25;
    else obscurity = 0;`,
    '冷门带宽：1 万评归零',
  ],
]);

// ---------- 3. 现场页加「不看 HOT」 ----------
patchFile(SITE + 'app.js', [
  [
    '  const section = (title, desc, items, opts = {}) => {',
    `  const hideHot = state.hideHot;
  const section = (title, desc, items, opts = {}) => {`,
    '现场：读取开关',
  ],
  [
    `    const rows = items
      .map((it) => {
        const g = eventIndex.get(it.id);
        if (!g) return null;
        return { g, deal: deals.get(it.id) || it };
      })
      .filter(Boolean);`,
    `    const rows = items
      .map((it) => {
        const g = eventIndex.get(it.id);
        if (!g) return null;
        return { g, deal: deals.get(it.id) || it };
      })
      .filter(Boolean)
      .filter((r) => !hideHot || (r.g.rev?.total || 0) < 10000);`,
    '现场：过滤热门',
  ],
  [
    '  box.innerHTML = [',
    `  box.innerHTML = \`
    <label class="chk" style="display:inline-flex;margin:2px 0 10px">
      <input type="checkbox" id="hideHotEv" ${state.hideHot ? 'checked' : ''}> 不看热门（评测 &gt; 1 万）
    </label>\` + [`,
    '现场：插入开关',
  ],
]);

// ---------- 4. 盲盒页工具栏加「不看热门」 ----------
patchFile(SITE + 'index.html', [
  [
    '<label class="date-ctl" title="按发售日期筛选（留空＝不限）">',
    '<label class="chk" title="只显示评测数少于 1 万的冷门作品"><input type="checkbox" id="hideHot"> 不看热门</label>\n      <label class="date-ctl" title="按发售日期筛选（留空＝不限）">',
    '盲盒：加开关',
  ],
]);

// ---------- 5. 事件绑定 ----------
patchFile(SITE + 'app.js', [
  [
    "  $('#loadMore').addEventListener('click', () => {",
    `  $('#hideHot')?.addEventListener('change', (e) => {
    state.hideHot = e.target.checked;
    try { localStorage.setItem('lh.hideHot', state.hideHot ? '1' : '0'); } catch {}
    roll();
    if (state.view === 'events') renderEvents();
  });
  try { state.hideHot = localStorage.getItem('lh.hideHot') === '1'; } catch {}
  const hh = $('#hideHot');
  if (hh) hh.checked = Boolean(state.hideHot);

  $('#eventsBody')?.addEventListener('change', (e) => {
    if (e.target.id !== 'hideHotEv') return;
    state.hideHot = e.target.checked;
    try { localStorage.setItem('lh.hideHot', state.hideHot ? '1' : '0'); } catch {}
    renderEvents();
  });

  $('#loadMore').addEventListener('click', () => {`,
    '绑定两个开关',
  ],
]);

// ---------- 6. 盲盒池过滤 ----------
patchFile(SITE + 'app.js', [
  [
    '  if (state.minPct) params.set(\'minPct\', String(state.minPct));',
    '  if (state.hideHot) params.set(\'maxReviews\', \'9999\');\n  if (state.minPct) params.set(\'minPct\', String(state.minPct));',
    '盲盒：请求带 maxReviews',
  ],
]);

console.log(log.join('\n'));
