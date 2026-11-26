// 把项目打成一个纯静态站点（dist/）：相似度引擎跑在浏览器里，不需要 Node 后端
// 用途：GitHub Pages 永久托管 + 打包进桌面客户端
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, dataPath } from '../server/store.mjs';

const ROOT = process.cwd();
const PUB = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');

const TAG_LIMIT = 20;

async function build() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(path.join(DIST, 'data'), { recursive: true });

  const corpus = await readJson(dataPath('corpus.json'), null);
  if (!corpus?.games) throw new Error('缺少 data/corpus.json，先跑 server/build-corpus.mjs');

  // 英文/原名，用于中文名之外的关键词搜索
  const snapshot = await readJson(dataPath('steam-db.json'), null);
  const altName = new Map();
  if (snapshot) {
    for (const a of Object.values(snapshot)) {
      if (a?.appid && a.name) altName.set(Number(a.appid), String(a.name));
    }
  }

  const tagDict = {};
  const labelSet = new Set();
  const games = [];

  for (const g of Object.values(corpus.games)) {
    if (!g || !Array.isArray(g.tags) || !g.tags.length) continue;
    const tags = g.tags.slice(0, TAG_LIMIT).map((t) => [t.id, Math.round(t.w || 0)]);
    for (const [tid] of tags) if (!tagDict[tid]) tagDict[tid] = corpus.tagDict?.[tid]?.zh ?? `标签${tid}`;
    if (g.rev?.label) labelSet.add(g.rev.label);

    // 英文名：优先用回填的官方英文名，其次用快照原名
    const en = g.en || altName.get(g.id) || null;
    const altOut = en && String(en).toLowerCase() !== String(g.name).toLowerCase() ? en : null;

    games.push([
      g.id,
      g.name,
      tags,
      g.rev?.total ?? 0,
      g.rev?.pct ?? 0,
      0, // label 索引稍后回填
      g.year ?? null,
      g.price ?? null,
      g.free ? 1 : 0,
      altOut,
      g.desc ? String(g.desc).slice(0, 220) : null,
      [g.dev ?? null, g.pub ?? null, g.req ? String(g.req).slice(0, 600) : null],
      g.relTs ? Math.floor(g.relTs) : g.year ? Math.floor(Date.UTC(g.year, 0, 1) / 1000) : null,
    ]);
  }

  const labels = [...labelSet];
  const labelIdx = new Map(labels.map((l, i) => [l, i + 1]));
  for (const row of games) {
    const g = corpus.games[row[0]];
    row[5] = g.rev?.label ? labelIdx.get(g.rev.label) ?? 0 : 0;
  }
  // label 0 表示无
  labels.unshift('');

  games.sort((a, b) => b[3] - a[3]); // 按评测数降序，热门在前，索引更稳定

  const payload = {
    built: (corpus.builtAt || new Date().toISOString()).slice(0, 10),
    tagDict,
    labels,
    games,
  };
  const jsonPath = path.join(DIST, 'data', 'games.json');
  await fs.writeFile(jsonPath, JSON.stringify(payload), 'utf8');
  const st = await fs.stat(jsonPath);
  const sizeMB = st.size / 1024 / 1024;

  // 版本指纹：前端先取它，再按版本号拉 games.json，避免浏览器缓存在旧语料上
  const version = {
    v: `${payload.built}-${games.length}-${st.size}`,
    built: payload.built,
    count: games.length,
    tags: Object.keys(tagDict).length,
    bytes: st.size,
  };
  await fs.writeFile(path.join(DIST, 'data', 'version.json'), JSON.stringify(version), 'utf8');

  // 静态资源
  for (const f of ['app.js', 'style.css', 'local-api.js', 'avatar.jpg', 'vision.json']) {
    await fs.copyFile(path.join(PUB, f), path.join(DIST, f));
  }
  // 字体目录
  const fontDir = path.join(PUB, 'fonts');
  try {
    await fs.mkdir(path.join(DIST, 'fonts'), { recursive: true });
    for (const f of await fs.readdir(fontDir)) {
      await fs.copyFile(path.join(fontDir, f), path.join(DIST, 'fonts', f));
    }
  } catch {
    console.warn('字体目录缺失，跳过（不影响功能，只是西文字体回落系统字体）');
  }

  // index.html：改成相对路径 + 打开静态开关 + 在 app.js 之前挂上本地引擎 + 资源加版本号（防缓存）
  let html = await fs.readFile(path.join(PUB, 'index.html'), 'utf8');
  const st2 = await Promise.all(['app.js', 'style.css', 'local-api.js'].map((n) => fs.stat(path.join(DIST, n))));
  const codeTag = st2.reduce((s, x) => s + x.size, 0).toString(36);
  const v = encodeURIComponent(version.v + '-' + codeTag);
  html = html
    .replace(/(["'(])\/(style\.css|app\.js|local-api\.js|avatar\.jpg)/g, '$1$2')
    .replace('href="style.css"', `href="style.css?v=${v}"`)
    .replace('src="local-api.js"', `src="local-api.js?v=${v}"`)
    .replace(
      '<script src="app.js" type="module"></script>',
      `<script>window.LIGHTHOUSE_STATIC = true;</script>
<script src="local-api.js?v=${v}"></script>
<script src="app.js?v=${v}" type="module"></script>`
    )
    .replace(
      '</head>',
      `  <meta property="og:title" content="Steam 灯塔 · 找到没人注意到的那些游戏">
  <meta property="og:description" content="随机盲盒发现冷门佳作 + 多游戏加权相似检索（静态版，离线可跑）">
</head>`
    );

  if (!html.includes('LIGHTHOUSE_STATIC')) throw new Error('index.html 注入失败：找不到 app.js 脚本标签');
  await fs.writeFile(path.join(DIST, 'index.html'), html, 'utf8');
  // 封面视觉特征（能抓多少算多少，前端按 data/vision.json 读取）
  try {
    await fs.copyFile(path.join(PUB, 'data', 'vision.json'), path.join(DIST, 'data', 'vision.json'));
  } catch {
    /* 没有特征库就跳过，画风只做同分微调，不影响主流程 */
  }

  // 更新日志（由云端同步生成，放在站点仓库 data/ 下）
  try {
    const logSrc = path.join('D:\\综合创作\\SteamSearchAny-web', 'data', 'changelog.json');
    const logTxt = await fs.readFile(logSrc, 'utf8');
    await fs.writeFile(path.join(DIST, 'data', 'changelog.json'), logTxt, 'utf8');
  } catch {
    await fs.writeFile(path.join(DIST, 'data', 'changelog.json'), '[]', 'utf8');
  }

  // SEO：robots.txt + sitemap.xml + 社交分享图
  const SITE = 'https://ostonefisho.github.io/SteamSearchAny-web/';
  await fs.writeFile(
    path.join(DIST, 'robots.txt'),
    ['User-agent: *', 'Allow: /', `Sitemap: ${SITE}sitemap.xml`, ''].join('\n'),
    'utf8'
  );
  const today = new Date().toISOString().slice(0, 10);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const STYLE = `<style>body{margin:0;background:#070a0e;color:#eaf2fa;font:15px/1.7 system-ui,-apple-system,"Microsoft YaHei",sans-serif}main{max-width:1040px;margin:0 auto;padding:34px 20px}a{color:#4cc2ff;text-decoration:none}a:hover{text-decoration:underline}h1{font-size:26px;margin:0 0 10px;letter-spacing:-.01em}p.meta{color:#7f95a8;font-size:13px;margin:0 0 18px}ul{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:0 20px;margin:0}li{padding:7px 0;border-bottom:1px solid #14202c;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}li span{color:#7f95a8;font-size:12px}.cta{display:inline-block;margin-top:26px;padding:10px 18px;border-radius:10px;background:#45bdf7;color:#05161f;font-weight:600}.foot{margin-top:28px;color:#5e7994;font-size:12px}</style>`;

  const rows = games.map((r) => ({
    id: r[0],
    name: r[1],
    total: r[3] || 0,
    pct: r[4] || 0,
    year: r[6] || null,
    tags: (r[2] || []).map((t) => t[0]),
  }));
  const byReviews = [...rows].sort((a, b) => b.total - a.total);
  const tagCount = new Map();
  for (const g of rows) for (const t of g.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
  const topGames = byReviews.slice(0, 300);

  const pageHtml = (title, desc, h1, meta, list, backHref) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow">${STYLE}</head>
<body><main><h1>${esc(h1)}</h1><p class="meta">${esc(meta)}</p><ul>
${list.map((g) => `<li><a href="${backHref}?ids=${g.id}">${esc(g.name)}</a> <span>· ${g.year || '—'} · ${g.pct}% 好评 · ${g.total.toLocaleString()} 评</span></li>`).join('\n')}
</ul><a class="cta" href="${backHref}">→ 打开 Steam 灯塔</a>
<p class="foot">数据来自 Steam 商店公开接口 · 每日自动更新 · <a href="https://github.com/OStonefishO/SteamSearchAny">开源</a></p>
</main></body></html>`;

  const urls = [SITE];
  try {
    for (const [tid, cnt] of topTags) {
      const zh = tagDict[tid] || `标签${tid}`;
      const list = byReviews.filter((g) => g.tags.includes(tid)).slice(0, 60);
      const dir = path.join(DIST, 'tag', String(tid));
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'index.html'),
        pageHtml(
          `${zh} 类游戏推荐（${cnt} 款）· Steam 灯塔`,
          `Steam 灯塔收录 ${cnt} 款「${zh}」标签的 Steam 游戏，按评测热度排序，含好评率与发售年份，可一键检索相似作品。`,
          `${zh} 类游戏推荐`,
          `共 ${cnt} 款带「${zh}」标签的游戏 · 按热度排序`,
          list,
          '../../'
        ),
        'utf8'
      );
      urls.push(`${SITE}tag/${tid}/`);
    }
    for (const g of topGames) {
      const dir = path.join(DIST, 'game', String(g.id));
      await fs.mkdir(dir, { recursive: true });
      const related = byReviews.filter((x) => x.id !== g.id && x.tags.some((t) => g.tags.includes(t))).slice(0, 24);
      await fs.writeFile(
        path.join(dir, 'index.html'),
        pageHtml(
          `${g.name} · 类似游戏推荐 · Steam 灯塔`,
          `${g.name}（${g.year || '未知年份'}，${g.pct}% 好评 / ${g.total.toLocaleString()} 条评测）的相似作品推荐，基于 Valve 官方标签权重计算。`,
          g.name,
          `${g.year || '未知年份'} · ${g.pct}% 好评 · ${g.total.toLocaleString()} 条评测`,
          related,
          '../../'
        ),
        'utf8'
      );
      urls.push(`${SITE}game/${g.id}/`);
    }
  } catch (e) {
    console.warn('入口页生成部分失败：', e.message);
  }

  await fs.writeFile(
    path.join(DIST, 'sitemap.xml'),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map(
        (u, i) =>
          `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>${i === 0 ? 'daily' : 'weekly'}</changefreq><priority>${i === 0 ? '1.0' : '0.7'}</priority></url>`
      ),
      '</urlset>',
      '',
    ].join('\n'),
    'utf8'
  );
  console.log(`入口页：${topTags.length} 个标签页 + ${topGames.length} 个游戏页 · sitemap ${urls.length} 条`);
  try {
    await fs.copyFile(path.join(ROOT, 'preview', '0-网址卡片.png'), path.join(DIST, 'og.png'));
  } catch {
    /* 没有分享图就跳过 */
  }

  await fs.writeFile(path.join(DIST, '.nojekyll'), '', 'utf8');

  // 静态版自己的说明
  await fs.writeFile(
    path.join(DIST, 'README.txt'),
    [
      'Steam 灯塔 · 静态版',
      `数据日期：${payload.built}`,
      `游戏数：${games.length}`,
      `标签数：${Object.keys(tagDict).length}`,
      '',
      '全部逻辑（含相似度计算）在浏览器里跑，不需要任何后端。',
      '本地预览：任意静态服务器指向本目录即可，例如 python -m http.server',
      '',
    ].join('\n'),
    'utf8'
  );

  console.log(`dist/ 完成：${games.length} 款游戏 · ${Object.keys(tagDict).length} 标签 · ${sizeMB.toFixed(2)} MB`);
  console.log(`入口：${path.join(DIST, 'index.html')}`);
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
