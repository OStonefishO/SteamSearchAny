// 一次性修补：冷门指数衰减更陡 + 评测 ≥5000 标注 HOT（网站 + 小程序）
import fs from 'node:fs';

const SITE = 'D:/综合创作/steam-lighthouse/public/';
const MP = 'D:/综合创作/steam-lighthouse-mp/src/';

const log = [];
function patch(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [from, to, label] of pairs) {
    if (!s.includes(from)) {
      log.push(`MISS  ${file.split('/').pop()} :: ${label}`);
      continue;
    }
    s = s.split(from).join(to);
    log.push(`ok    ${file.split('/').pop()} :: ${label}`);
  }
  fs.writeFileSync(file, s, 'utf8');
}

// ---------- 1. 冷门指数：热门作品直接归零 ----------
patch(SITE + 'local-api.js', [
  [
    `if (total <= 120) obscurity = 1;
    else if (total <= 1000) obscurity = 1 - ((total - 120) / 880) * 0.35;
    else if (total <= 10000) obscurity = 0.65 - ((total - 1000) / 9000) * 0.35;
    else if (total <= 60000) obscurity = 0.3 - ((total - 10000) / 50000) * 0.2;
    else obscurity = 0.05;`,
    `if (total <= 120) obscurity = 1;
    else if (total <= 1000) obscurity = 1 - ((total - 120) / 880) * 0.35;
    else if (total <= 5000) obscurity = 0.65 - ((total - 1000) / 4000) * 0.35;
    else if (total <= 20000) obscurity = 0.3 - ((total - 5000) / 15000) * 0.25;
    else obscurity = 0;`,
    'obscurity 衰减更陡，>2 万评测归零',
  ],
]);

// ---------- 2. 网站前端：HOT 角标 ----------
const PILL_OLD = '<span class="card-pill right">冷门 ${g.gem ?? 0}</span>';
const PILL_NEW =
  '<span class="card-pill right${(g.rev?.total || 0) >= 5000 ? \' hot\' : \'\'}">${(g.rev?.total || 0) >= 5000 ? \'HOT\' : \'冷门 \' + (g.gem ?? 0)}</span>';

patch(SITE + 'app.js', [
  [PILL_OLD, PILL_NEW, '卡片角标改 HOT'],
  [
    '<div class="hero-eyebrow"><span class="spark"></span>今日捞到 · 冷门指数 ${gem}</div>',
    '<div class="hero-eyebrow"><span class="spark"></span>${rev.total >= 5000 ? \'热门在卖 · \' + shortNum(rev.total) + \' 条评测\' : \'今日捞到 · 冷门指数 \' + gem}</div>',
    '主卡文案区分热门/冷门',
  ],
  [
    '<div class="stat hot"><b>${gem}</b><span>冷门指数</span></div>',
    '<div class="stat hot"><b>${rev.total >= 5000 ? \'HOT\' : gem}</b><span>${rev.total >= 5000 ? \'热门\' : \'冷门指数\'}</span></div>',
    '主卡数据块',
  ],
  [
    '<div class="stat"><b>${full.gem ?? 0}</b><span>冷门指数</span></div>',
    '<div class="stat"><b>${(full.rev?.total || 0) >= 5000 ? \'HOT\' : (full.gem ?? 0)}</b><span>${(full.rev?.total || 0) >= 5000 ? \'热门\' : \'冷门指数\'}</span></div>',
    '详情弹窗数据块',
  ],
  [
    "${full.gem ? `<span class=\"info-gem\">冷门 ${full.gem}</span>` : ''}",
    "${(full.rev?.total || 0) >= 5000 ? `<span class=\"info-gem hot\">HOT ${full.rev.total.toLocaleString()} 评测</span>` : full.gem ? `<span class=\"info-gem\">冷门 ${full.gem}</span>` : ''}",
    '资料面板标签',
  ],
  [
    'section(\'💸 打折中的隐藏佳作\', \'按冷门指数排序 —— 便宜、好评、还没人发现\'',
    'section(\'💸 打折中的好价\', \'冷门佳作优先 —— 便宜、好评、还没人发现\'',
    '现场板块标题',
  ],
]);

// ---------- 3. 小程序：同样规则 ----------
patch(MP + 'main.js', [
  [
    'const gemOf = (g) => {',
    'const HOT_REVIEWS = 5000;\nconst isHot = (g) => (g.rev?.total || 0) >= HOT_REVIEWS;\nconst gemOf = (g) => {',
    '加 HOT 判定',
  ],
  [
    `if (total <= 120) o = 1;
  else if (total <= 1000) o = 1 - ((total - 120) / 880) * 0.35;
  else if (total <= 10000) o = 0.65 - ((total - 1000) / 9000) * 0.35;
  else o = 0.2;`,
    `if (total <= 120) o = 1;
  else if (total <= 1000) o = 1 - ((total - 120) / 880) * 0.35;
  else if (total <= 5000) o = 0.65 - ((total - 1000) / 4000) * 0.35;
  else if (total <= 20000) o = 0.3 - ((total - 5000) / 15000) * 0.25;
  else o = 0;`,
    '小程序冷门衰减',
  ],
  [
    '<span class="pill r">冷门 ${gemOf(g)}</span>',
    '<span class="pill r${isHot(g) ? \' hot\' : \'\'}">${isHot(g) ? \'HOT\' : \'冷门 \' + gemOf(g)}</span>',
    '小程序卡片角标',
  ],
  [
    '<div class="eyebrow">今日捞到 · 冷门指数 ${gemOf(hero)}</div>',
    '<div class="eyebrow">${isHot(hero) ? \'热门在卖 · \' + hero.rev.total.toLocaleString() + \' 条评测\' : \'今日捞到 · 冷门指数 \' + gemOf(hero)}</div>',
    '小程序主卡文案',
  ],
]);

// ---------- 4. CSS ----------
patch(SITE + 'style.css', [
  ['.card-pill.deal {', '.card-pill.hot { color: #ffb04d; border-color: rgba(255, 176, 77, 0.5); background: rgba(255, 176, 77, 0.14); }\n.info-gem.hot { color: #ffb04d; border-color: rgba(255, 176, 77, 0.4); }\n.card-pill.deal {', '网站 HOT 样式'],
]);
patch(MP + 'styles.css', [
  ['.pill.good { color: var(--lime); }', '.pill.hot { color: #ffb04d; border-color: rgba(255, 176, 77, 0.5); }\n.pill.good { color: var(--lime); }', '小程序 HOT 样式'],
]);

console.log(log.join('\n'));
