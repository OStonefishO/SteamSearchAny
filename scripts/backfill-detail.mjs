// 回填：给每款游戏补「简介」和「英文名」，供悬停浮层与中英文搜索使用
// 走 IStoreBrowseService/GetItems：schinese 取 short_description，english 取官方英文名
import { dataPath, writeJson, readJson } from '../server/store.mjs';
import fs from 'node:fs/promises';

const API = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const BATCH = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 99999;

async function getItems(ids, language, extra = {}) {
  const body = encodeURIComponent(
    JSON.stringify({
      ids: ids.map((appid) => ({ appid })),
      context: { language, country_code: language === 'english' ? 'US' : 'CN' },
      data_request: {
        include_tag_count: 1,
        include_reviews: false,
        include_assets: false,
        include_release: false,
        include_basic_info: true,
        ...extra,
      },
    })
  );
  for (let i = 0; i < 4; i += 1) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(`${API}?input_json=${body}`, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return j?.response?.store_items ?? [];
    } catch {
      await sleep(800 * (i + 1));
    }
  }
  return [];
}

const clean = (s) =>
  String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

async function main() {
  const corpus = await readJson(dataPath('corpus.json'), null);
  if (!corpus?.games) throw new Error('缺少 data/corpus.json');
  const all = Object.values(corpus.games);

  const needDesc = all.filter((g) => !g.desc).map((g) => g.id);
  const needEn = all.filter((g) => !g.en).map((g) => g.id);
  console.log(`语料 ${all.length} 款；缺简介 ${needDesc.length}，缺英文名 ${needEn.length}`);

  let done = 0;
  const targets = [...new Set([...needDesc, ...needEn])].slice(0, LIMIT);
  const targetSet = new Set(targets);
  console.log(`本轮处理 ${targets.length} 款`);

  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH);
    const [zhItems, enItems] = await Promise.all([
      getItems(chunk, 'schinese'),
      getItems(chunk, 'english'),
    ]);

    for (const it of zhItems) {
      if (it?.success !== 1) continue;
      const g = corpus.games[it.appid ?? it.id];
      if (!g) continue;
      const d = clean(it.basic_info?.short_description || '');
      if (d) g.desc = d.length > 220 ? `${d.slice(0, 218)}…` : d;
      if (it.basic_info?.developers?.[0]?.name) g.dev = it.basic_info.developers[0].name;
    }
    for (const it of enItems) {
      if (it?.success !== 1) continue;
      const g = corpus.games[it.appid ?? it.id];
      if (!g) continue;
      const en = String(it.name || '').trim();
      if (en && en !== g.name) g.en = en;
    }

    done += chunk.length;
    process.stdout.write(`\r  进度 ${done}/${targets.length}`);
    await sleep(120);
  }
  console.log('');

  corpus.builtAt = new Date().toISOString();
  await writeJson(dataPath('corpus.json'), corpus);

  const withDesc = Object.values(corpus.games).filter((g) => g.desc).length;
  const withEn = Object.values(corpus.games).filter((g) => g.en).length;
  console.log(`完成：有简介 ${withDesc} 款，有英文名 ${withEn} 款`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('回填失败:', e.message);
  process.exit(1);
});
