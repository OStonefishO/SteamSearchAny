// 回填开发商 / 发行商（GetItems 的 basic_info），供「游戏资料」面板使用
import { dataPath, writeJson, readJson } from '../server/store.mjs';

const API = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const BATCH = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getItems(ids) {
  const body = encodeURIComponent(
    JSON.stringify({
      ids: ids.map((appid) => ({ appid })),
      context: { language: 'schinese', country_code: 'CN' },
      data_request: { include_tag_count: 1, include_basic_info: true, include_reviews: false, include_assets: false, include_release: false },
    })
  );
  for (let i = 0; i < 4; i += 1) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25000);
      const res = await fetch(`${API}?input_json=${body}`, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json())?.response?.store_items ?? [];
    } catch {
      await sleep(700 * (i + 1));
    }
  }
  return [];
}

async function main() {
  const corpus = await readJson(dataPath('corpus.json'), null);
  if (!corpus?.games) throw new Error('缺少 corpus.json');
  const need = Object.values(corpus.games).filter((g) => !g.pub || !g.dev).map((g) => g.id);
  console.log(`需要补开发商/发行商：${need.length} 款`);

  let done = 0;
  for (let i = 0; i < need.length; i += BATCH) {
    const chunk = need.slice(i, i + BATCH);
    const items = await getItems(chunk);
    for (const it of items) {
      if (it?.success !== 1) continue;
      const g = corpus.games[it.appid ?? it.id];
      if (!g) continue;
      const dev = it.basic_info?.developers?.[0]?.name;
      const pub = it.basic_info?.publishers?.[0]?.name;
      if (dev && !g.dev) g.dev = dev;
      if (pub && !g.pub) g.pub = pub;
    }
    done += chunk.length;
    process.stdout.write(`\r  ${done}/${need.length}`);
    await sleep(110);
  }
  console.log('');

  corpus.builtAt = new Date().toISOString();
  await writeJson(dataPath('corpus.json'), corpus);
  const all = Object.values(corpus.games);
  console.log(`完成：有开发商 ${all.filter((g) => g.dev).length}，有发行商 ${all.filter((g) => g.pub).length}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
