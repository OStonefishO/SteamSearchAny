// 把线上站点仓库里新增的游戏，合并回本地语料 data/corpus.json
// 为什么需要：云端 Actions 会往站点仓库的 games.json 里加游戏，本地语料是另一个文件；
// 如果本地直接构建再推送，会把云端新增的覆盖掉。所以每次构建/发布前先做一次反向合并。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataPath, writeJson, readJson } from '../server/store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = process.argv.find((a) => a.startsWith('--web='))?.split('=')[1] || 'D:\\综合创作\\SteamSearchAny-web';
const CDN = (id, file) => `https://cdn.akamai.steamstatic.com/steam/apps/${id}/${file}`;

async function main() {
  const corpus = await readJson(dataPath('corpus.json'), null);
  if (!corpus?.games) throw new Error('缺少 data/corpus.json');

  const gamesFile = path.join(WEB, 'data', 'games.json');
  let web;
  try {
    web = JSON.parse(await fs.readFile(gamesFile, 'utf8'));
  } catch {
    console.log('读不到站点仓库的 games.json，跳过合并');
    return { added: 0 };
  }

  const before = Object.keys(corpus.games).length;
  const labels = web.labels || [];
  const tagDict = corpus.tagDict || {};
  let added = 0;
  let newTags = 0;

  for (const row of web.games || []) {
    const [id, name, tags, total, pct, labelIdx, year, price, free] = row;
    if (corpus.games[id]) continue;
    corpus.games[id] = {
      id,
      name,
      tags: (tags || []).map(([tid, w]) => ({ id: tid, w })),
      rev: total
        ? { total, pct, label: labels[labelIdx] || null, score: 0 }
        : null,
      year: year ?? null,
      relTs: null,
      price: price ?? null,
      free: Boolean(free),
      header: CDN(id, 'header.jpg'),
      cover: CDN(id, 'library_600x900.jpg'),
    };
    added += 1;
  }

  // 标签名回填
  for (const [tid, zh] of Object.entries(web.tagDict || {})) {
    if (!tagDict[tid]) {
      tagDict[tid] = { zh, en: '', count: 0 };
      newTags += 1;
    } else if (!tagDict[tid].zh && zh) {
      tagDict[tid].zh = zh;
    }
  }

  if (added) {
    corpus.games = corpus.games;
    corpus.tagDict = tagDict;
    await writeJson(dataPath('corpus.json'), corpus);
  }

  console.log(`反向合并：${before} → ${Object.keys(corpus.games).length}（新增 ${added} 款，新标签 ${newTags} 个）`);
  return { added, total: Object.keys(corpus.games).length };
}

main().catch((e) => {
  console.error('合并失败:', e.message);
  process.exit(1);
});
