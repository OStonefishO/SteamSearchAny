// 增量补全：现代热作 / 榜单 / 手工核验的热门 appid
// 快照年代偏旧（2021 前），这里补上 2022-2026 的作品，让用户拿熟悉的大作当种子时有数据
import { dataPath, writeJson } from '../server/store.mjs';
import { getItems, toRecord, loadState, resolveTags, stateToCorpus, sleep } from '../server/build-corpus.mjs';

const API = 'https://api.steampowered.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function api(pathAndQuery) {
  for (let i = 0; i < 6; i += 1) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const res = await fetch(`${API}${pathAndQuery}`, {
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch {
      await sleep(1200 * (i + 1));
    }
  }
  return null;
}

/** 去掉商标 / 标点差异后比较，避免 ®™《》 这类符号造成误判 */
const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[\u00ae\u2122\u00a9:：\-–—_'"'`.,!?()（）《》【】·|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// [appid, 名称应包含的关键词]（中英文名任一命中即保留）
const CURATED = [
  [275850, "No Man"], [105600, 'Terraria'], [413150, 'Stardew'], [1145350, 'Hades'],
  [1245620, 'ELDEN RING'], [1091500, 'Cyberpunk'], [292030, 'Witcher 3'], [588650, 'Dead Cells'],
  [322330, "Don't Starve Together"], [268910, 'Cuphead'], [4000, "Garry's Mod"], [400, 'Portal'],
  [526870, 'Satisfactory'], [255710, 'Cities: Skylines'], [289070, 'Civilization'], [359320, 'Elite Dangerous'],
  [251570, '7 Days to Die'], [632360, 'Risk of Rain 2'], [753640, 'Outer Wilds'], [367520, 'Hollow Knight'],
  [391540, 'Undertale'], [219740, "Don't Starve"], [239030, 'Papers, Please'], [250900, 'Binding of Isaac'],
  [457140, 'Oxygen Not Included'], [427520, 'Factorio'], [281990, 'Stellaris'], [236850, 'Europa Universalis'],
  [323190, 'Frostpunk'], [648800, 'Raft'], [221380, 'Age of Empires'], [239140, 'Dying Light'],
  [550, 'Left 4 Dead 2'], [730, 'Counter-Strike'], [570, 'Dota'], [578080, 'PUBG'], [1172470, 'Apex'],
  [359550, 'Rainbow Six'], [444090, 'Paladins'], [230410, 'Warframe'], [238960, 'Path of Exile'],
  [271590, 'Grand Theft Auto V'], [1237970, 'Titanfall'], [990080, 'Hogwarts Legacy'], [1174180, 'Red Dead'],
  [1817070, 'Spider-Man'], [2050650, 'Resident Evil 4'], [2358720, 'Black Myth'], [1966720, 'Lethal Company'],
  [1593500, 'God of War'], [1888930, 'The Last of Us'], [1794680, 'Vampire Survivors'], [1426210, 'It Takes Two'],
  [1259420, 'Days Gone'], [1551360, 'Forza Horizon 5'], [1623730, 'Palworld'], [1240440, 'Halo Infinite'],
  [594650, 'Hunt: Showdown'], [686810, 'Hell Let Loose'], [739630, 'Phasmophobia'], [945360, 'Among Us'],
  [108600, 'Project Zomboid'], [294100, 'RimWorld'], [377160, 'Fallout 4'], [489830, 'Skyrim'],
  [22380, 'Fallout: New Vegas'], [72850, 'Skyrim'], [203160, 'Tomb Raider'], [391220, 'Rise of the Tomb Raider'],
  [268500, 'XCOM'], [306130, 'Elder Scrolls'], [392160, 'X4'], [1086940, "Baldur's Gate"],
  [553850, 'Helldivers'], [2357570, 'Overwatch'], [2073850, 'THE FINALS'], [582010, 'Monster Hunter'],
  [1446780, 'Monster Hunter Rise'], [601150, 'Devil May Cry'], [883710, 'Resident Evil 2'], [952060, 'Resident Evil 3'],
  [1196590, 'Resident Evil Village'], [632470, 'Disco Elysium'], [435150, 'Divinity: Original Sin'],
  [590380, 'Into the Breach'], [646570, 'Slay the Spire'], [1888160, 'Armored Core'], [1364780, 'Street Fighter'],
  [460950, 'KATANA ZERO'], [1057090, 'Ori and the Will'], [261570, 'Ori and the Blind'], [311690, 'Enter the Gungeon'],
  [242680, 'Nuclear Throne'], [253230, 'A Hat in Time'], [319630, 'Life is Strange'], [346110, 'ARK'],
  [453480, 'Shadow Tactics'], [477160, 'Human Fall Flat'], [493340, 'Planet Coaster'], [524220, 'NieR'],
  [613100, 'House Flipper'], [674940, 'Stick Fight'], [728880, 'Overcooked'], [782330, 'DOOM Eternal'],
  [814380, 'Sekiro'], [892970, 'Valheim'], [976310, 'Mortal Kombat'], [1030840, 'Mafia'],
  [1139900, 'Ghostrunner'], [1158310, 'Crusader Kings'], [1332010, 'Stray'], [1384160, 'GUILTY GEAR'],
  [1517290, 'Battlefield'], [1599340, 'Lost Ark'], [1604030, 'V Rising'], [1868140, 'DAVE THE DIVER'],
  [2215430, 'Ghost of Tsushima'], [252490, 'Rust'], [244210, 'Assetto Corsa'], [257850, 'Hyper Light Drifter'],
  [261550, 'Mount & Blade'], [264710, 'Subnautica'], [2868840, 'Slay the Spire 2'],
  [236390, 'War Thunder'], [242760, 'The Forest'], [1326470, 'Sons of the Forest'], [1938090, 'Call of Duty'],
  [1203220, 'NARAKA'], [2139460, 'Once Human'], [2114740, 'Dune'], [2289800, 'Squad'],
  [2246340, 'Monster Hunter Wilds'], [2183900, 'Warhammer'],
];

async function main() {
  const state = await loadState();
  const before = Object.keys(state.done).length;
  const collected = new Set();

  const topReleases = await api('/ISteamChartsService/GetTopReleasesPages/v1/');
  for (const page of topReleases?.response?.pages ?? []) {
    for (const it of page.item_ids ?? []) if (it.appid) collected.add(Number(it.appid));
  }
  for (const path of ['/ISteamChartsService/GetMostPlayedGames/v1/', '/ISteamChartsService/GetGamesByConcurrentPlayers/v1/']) {
    const j = await api(path);
    for (const r of j?.response?.ranks ?? []) if (r.appid) collected.add(Number(r.appid));
  }
  const curated = new Map(CURATED.map(([id, hint]) => [Number(id), hint]));
  for (const id of curated.keys()) collected.add(id);
  console.log(`待处理 appid ${collected.size}（榜单 + 手工清单 ${curated.size}）`);

  const ids = [...collected];
  let added = 0;
  const rejected = [];

  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    let items;
    try {
      items = await getItems(batch.map((appid) => ({ appid })), { retries: 6 });
    } catch (e) {
      console.log('批次失败，跳过', batch.length, e.message);
      continue;
    }
    for (const item of items) {
      const rec = toRecord(item);
      if (!rec) continue;
      const hint = curated.get(rec.id);
      if (hint && !norm(rec.name).includes(norm(hint))) {
        rejected.push({ rec, hint });
        continue;
      }
      if (!state.done[rec.id]) added += 1;
      state.done[rec.id] = rec;
    }
    process.stdout.write(`\r已入库 ${Object.keys(state.done).length} 款（+${added}）`);
    await sleep(120);
  }
  console.log('');

  // 中文名核验失败的用英文名再核一次
  if (rejected.length) {
    console.log(`中文名待复核 ${rejected.length} 条，取英文名核验…`);
    const englishNames = new Map();
    for (let i = 0; i < rejected.length; i += 100) {
      const batch = rejected.slice(i, i + 100).map((r) => r.rec.id);
      const body = encodeURIComponent(
        JSON.stringify({
          ids: batch.map((appid) => ({ appid })),
          context: { language: 'english', country_code: 'US' },
          data_request: { include_tag_count: 1 },
        })
      );
      try {
        const res = await fetch(`${API}/IStoreBrowseService/GetItems/v1/?input_json=${body}`, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
        });
        const j = await res.json();
        for (const it of j?.response?.store_items ?? []) {
          if (it?.appid) englishNames.set(Number(it.appid), String(it.name || ''));
        }
      } catch {
        /* 忽略 */
      }
      await sleep(150);
    }
    for (const { rec, hint } of rejected) {
      const en = englishNames.get(rec.id) || '';
      if (norm(en).includes(norm(hint))) {
        if (!state.done[rec.id]) added += 1;
        state.done[rec.id] = rec;
      } else {
        console.log(`  ✗ 丢弃 ${rec.id} ${rec.name} / ${en || '?'}（期望含 ${hint}）`);
      }
    }
  }

  const tagIds = new Set();
  for (const g of Object.values(state.done)) if (g) for (const t of g.tags) tagIds.add(t.id);
  await resolveTags(tagIds, state);

  state.finished = true;
  await writeJson(dataPath('build-state.json'), state);
  await writeJson(dataPath('corpus.json'), stateToCorpus(state));

  console.log(`完成：${before} → ${Object.keys(state.done).length} 款（新增 ${added}）`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
