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
  for (const f of ['app.js', 'style.css', 'local-api.js', 'avatar.jpg']) {
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
  const v = encodeURIComponent(version.v);
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
  // 更新日志（由云端同步生成，放在站点仓库 data/ 下）
  try {
    const logSrc = path.join('D:\\综合创作\\SteamSearchAny-web', 'data', 'changelog.json');
    const logTxt = await fs.readFile(logSrc, 'utf8');
    await fs.writeFile(path.join(DIST, 'data', 'changelog.json'), logTxt, 'utf8');
  } catch {
    await fs.writeFile(path.join(DIST, 'data', 'changelog.json'), '[]', 'utf8');
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
