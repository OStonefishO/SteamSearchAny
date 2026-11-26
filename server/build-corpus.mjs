// 语料库构建器（可续跑 / 断点续传 / 无限重试，专治 Valve 接口间歇性断流）
//
// 枚举来源：data/steam-db.json（Steam 产品库快照，约 8.7 万款可抽取条目）
// 数据来源：IStoreBrowseService/GetItems（Valve 免 key 接口）
//   appid → 名称 / 官方标签权重 / 好评率 / 评测数 / 发售日 / 价格 / 素材
//   tagid → 中文名 + 英文 slug + 游戏总数
//
// 进度落盘 data/build-state.json，中断后续跑不重复取数。
import fs from 'node:fs/promises';
import { dataPath, writeJson, readJson, ensureDir } from './store.mjs';

const API = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/';
const SHARED = 'https://shared.akamai.steamstatic.com/store_item_assets/';
const BATCH = 100;
const CONCURRENCY = 3;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 调 Valve GetItems，失败自动退避重试 */
export async function getItemsOnce(ids, { tagCount = 20, timeout = 40000 } = {}) {
  const body = encodeURIComponent(
    JSON.stringify({
      ids,
      context: { language: 'schinese', country_code: 'CN' },
      data_request: {
        include_tag_count: tagCount,
        include_reviews: true,
        include_assets: true,
        include_release: true,
        include_basic_info: false,
        include_platforms: false,
        include_all_purchase_options: false,
      },
    })
  );
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API}?input_json=${body}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json?.response?.store_items ?? [];
  } finally {
    clearTimeout(timer);
  }
}

/** 带重试的 GetItems（网络窗口内完成任务） */
export async function getItems(ids, { retries = 8, onRetry = null, ...rest } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await getItemsOnce(ids, rest);
    } catch (err) {
      lastErr = err;
      const wait = Math.min(30000, 700 * 2 ** i) + Math.random() * 400;
      onRetry?.(err, i, wait);
      await sleep(wait);
    }
  }
  throw lastErr ?? new Error('GetItems failed');
}

function assetUrl(item, field) {
  const assets = item?.assets;
  if (!assets?.asset_url_format) return null;
  const file = assets[field];
  if (!file) return null;
  return `${SHARED}${assets.asset_url_format.replace('${FILENAME}', file)}`;
}

export function toRecord(item) {
  if (!item || item.success !== 1) return null;
  if (item.type !== undefined && item.type !== 0) return null;
  const appid = Number(item.appid ?? item.id);
  if (!Number.isFinite(appid)) return null;

  const tags = (Array.isArray(item.tags) ? item.tags : [])
    .filter((t) => t && Number.isFinite(Number(t.tagid)))
    .map((t) => ({ id: Number(t.tagid), w: Number(t.weight) || 1 }))
    .slice(0, 20);
  if (!tags.length) return null;

  const rev = item.reviews?.summary_filtered;
  const relTs = item.release?.steam_release_date;
  const price = item.best_purchase_option?.formatted_final_price ?? null;

  return {
    id: appid,
    name: String(item.name ?? `App ${appid}`).trim(),
    tags,
    rev: rev
      ? {
          total: Number(rev.review_count) || 0,
          pct: Number(rev.percent_positive) || 0,
          label: rev.review_score_label || null,
          score: Number(rev.review_score) || 0,
        }
      : null,
    year: relTs ? new Date(relTs * 1000).getUTCFullYear() : null,
    relTs: relTs || null,
    price,
    free: typeof price === 'string' && /免费|Free/i.test(price),
    header: assetUrl(item, 'header') ?? assetUrl(item, 'main_capsule'),
    cover: assetUrl(item, 'library_capsule') ?? assetUrl(item, 'hero_capsule'),
  };
}

function shuffle(arr, seed = 1337) {
  const a = arr.slice();
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 从快照里按标签分层抽样（覆盖小众品类，天然包含大量冷门游戏） */
export async function selectAppIds({ target = 9000, snapshotPath = dataPath('steam-db.json') } = {}) {
  const snapshot = await readJson(snapshotPath, null);
  if (!snapshot) throw new Error(`缺少快照 ${snapshotPath}`);
  const entries = Object.values(snapshot).filter(
    (a) => a?.appid && Array.isArray(a.tags) && a.tags.length >= 3 && !a.parentappid && a.name?.length > 1
  );
  const byTag = new Map();
  for (const e of entries) {
    for (const t of e.tags) {
      let arr = byTag.get(t);
      if (!arr) byTag.set(t, (arr = []));
      arr.push(e.appid);
    }
  }
  const tagNames = [...byTag.keys()].sort((a, b) => byTag.get(b).length - byTag.get(a).length);
  const picked = new Set();
  const perTag = Math.max(8, Math.ceil(target / Math.max(1, tagNames.length)) * 3);
  let seed = 20260101;
  for (const t of tagNames) {
    const members = shuffle(byTag.get(t), (seed = (seed * 48271) % 2147483647));
    let taken = 0;
    for (const appid of members) {
      if (taken >= perTag) break;
      if (picked.has(appid)) continue;
      picked.add(appid);
      taken += 1;
      if (picked.size >= target) break;
    }
    if (picked.size >= target) break;
  }
  return { appids: [...picked], available: entries.length, tags: tagNames.length };
}

export async function loadState() {
  return (await readJson(dataPath('build-state.json'), null)) ?? {
    v: 1,
    createdAt: new Date().toISOString(),
    appids: [],
    done: {},
    tagDict: {},
    batchesDone: 0,
    batchesTotal: 0,
    finished: false,
  };
}

export async function resolveTags(tagIds, state, { retries = 10 } = {}) {
  const missing = [...tagIds].filter((id) => id && !state.tagDict[String(id)]);
  if (!missing.length) return state.tagDict;
  const chunks = [];
  for (let i = 0; i < missing.length; i += BATCH) chunks.push(missing.slice(i, i + BATCH));
  for (const chunk of chunks) {
    try {
      const items = await getItems(
        chunk.map((tagid) => ({ tagid })),
        { tagCount: 1, retries }
      );
      for (const item of items) {
        if (item?.item_type !== 4) continue;
        const slug = String(item.store_url_path || '').split('/').pop() || '';
        state.tagDict[String(item.id)] = {
          zh: item.name || slug || String(item.id),
          en: slug.replace(/_/g, ' '),
          count: Number(item.game_count) || 0,
        };
      }
    } catch {
      // 标签名缺失不致命，先用占位符
      for (const id of chunk) {
        if (!state.tagDict[String(id)]) state.tagDict[String(id)] = { zh: `标签${id}`, en: `tag-${id}`, count: 0 };
      }
    }
  }
  return state.tagDict;
}

export function stateToCorpus(state) {
  return {
    v: 2,
    builtAt: new Date().toISOString(),
    source: 'IStoreBrowseService/GetItems + Nebukam/steam-db snapshot',
    tagDict: state.tagDict,
    games: state.done,
  };
}

/**
 * 主构建流程（续跑式）
 */
export async function buildCorpus({
  target = 9000,
  append = 0,
  maxBatches = Infinity,
  onProgress = () => {},
  stopFlag = { stop: false },
} = {}) {
  await ensureDir();
  const state = await loadState();

  if (!state.appids.length) {
    onProgress({ phase: 'select', pct: 2, message: '按标签分层抽样…' });
    const sel = await selectAppIds({ target });
    state.appids = sel.appids;
    state.batchesTotal = Math.ceil(sel.appids.length / BATCH);
    await writeJson(dataPath('build-state.json'), state);
    onProgress({
      phase: 'select',
      pct: 5,
      message: `从 ${sel.available} 款可抽取条目中选出 ${sel.appids.length} 款，覆盖 ${sel.tags} 个标签`,
    });
  } else if (append > 0) {
    // 扩量：在已有池子之外再抽一批新条目
    onProgress({ phase: 'select', pct: 5, message: `扩量：再抽 ${append} 款…` });
    const have = new Set(state.appids);
    const sel = await selectAppIds({ target: state.appids.length + append * 2 });
    const fresh = sel.appids.filter((id) => !have.has(id)).slice(0, append);
    state.appids.push(...fresh);
    state.finished = false;
    await writeJson(dataPath('build-state.json'), state);
    onProgress({ phase: 'select', pct: 6, message: `新增 ${fresh.length} 款待补全，总计划 ${state.appids.length} 款` });
  }

  const pending = state.appids.filter((id) => !state.done[id]);
  let batches = [];
  for (let i = 0; i < pending.length; i += BATCH) batches.push(pending.slice(i, i + BATCH));
  onProgress({
    phase: 'enrich',
    pct: 8,
    games: Object.keys(state.done).length,
    remaining: pending.length,
    message: `待补全 ${pending.length} 款（${batches.length} 批），每批 ${BATCH} 款`,
  });

  let finishedBatches = 0;
  let consecutiveFails = 0;
  const queue = batches.slice(0, maxBatches === Infinity ? batches.length : maxBatches);

  const worker = async () => {
    while (queue.length && !stopFlag.stop) {
      const batch = queue.shift();
      if (!batch) break;
      try {
        const items = await getItems(
          batch.map((appid) => ({ appid })),
          { retries: 6, onRetry: () => { consecutiveFails += 1; } }
        );
        let got = 0;
        for (const item of items) {
          const rec = toRecord(item);
          if (rec) {
            state.done[rec.id] = rec;
            got += 1;
          }
        }
        // 取到但被过滤的（DLC/下架/无标签）也标记完成，避免反复重试
        for (const appid of batch) {
          if (!state.done[appid] && !items.some((it) => Number(it.appid ?? it.id) === appid && it.success === 1)) {
            state.done[appid] = null;
          }
        }
        finishedBatches += 1;
        state.batchesDone = (state.batchesDone || 0) + 1;
        // 周期性落盘，保证服务端随时能读到可用语料
        if (finishedBatches % 6 === 0) {
          await writeJson(dataPath('build-state.json'), state).catch(() => {});
          await writeJson(dataPath('corpus.json'), stateToCorpus(state)).catch(() => {});
        }
        const pct = 8 + Math.round((finishedBatches / queue.length) * 84);
        onProgress({
          phase: 'enrich',
          pct: Math.min(96, pct),
          games: Object.keys(state.done).filter((k) => state.done[k]).length,
          message: `已补全 ${Object.keys(state.done).filter((k) => state.done[k]).length} 款（本批 +${got}）`,
        });
      } catch (err) {
        // 把批次放回队列尾部，等网络窗口
        queue.push(batch);
        await sleep(4000 + Math.random() * 3000);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // 清理 null 占位
  for (const k of Object.keys(state.done)) if (!state.done[k]) delete state.done[k];

  // 标签字典
  const tagIds = new Set();
  for (const g of Object.values(state.done)) if (g) for (const t of g.tags) tagIds.add(t.id);
  onProgress({ phase: 'tags', pct: 97, message: `解析 ${tagIds.size} 个标签名称…` });
  await resolveTags(tagIds, state);

  state.finished = Object.keys(state.done).length >= state.appids.length * 0.9;
  await writeJson(dataPath('build-state.json'), state);
  const corpus = stateToCorpus(state);
  await writeJson(dataPath('corpus.json'), corpus);
  onProgress({
    phase: 'done',
    pct: 100,
    games: Object.keys(state.done).length,
    tags: Object.keys(state.tagDict).length,
    message: `语料库就绪：${Object.keys(state.done).length} 款游戏 · ${Object.keys(state.tagDict).length} 个标签`,
  });
  return corpus;
}

/** 按需补全单款游戏（用户搜索语料库外的游戏时调用） */
export async function enrichAppIds(appids, { retries = 3 } = {}) {
  const state = await loadState();
  const items = await getItems(
    appids.map((appid) => ({ appid: Number(appid) })),
    { retries }
  );
  const added = [];
  const tagIds = new Set();
  for (const item of items) {
    const rec = toRecord(item);
    if (rec) {
      state.done[rec.id] = rec;
      added.push(rec);
      for (const t of rec.tags) tagIds.add(t.id);
    }
  }
  if (tagIds.size) await resolveTags(tagIds, state);
  if (added.length) {
    await writeJson(dataPath('build-state.json'), state);
    await writeJson(dataPath('corpus.json'), stateToCorpus(state));
  }
  return added;
}

if (process.argv[1] && process.argv[1].endsWith('build-corpus.mjs')) {
  const targetArg = process.argv.find((a) => a.startsWith('--target='));
  const appendArg = process.argv.find((a) => a.startsWith('--append='));
  let lastLog = 0;
  buildCorpus({
    target: targetArg ? Number(targetArg.split('=')[1]) : 9000,
    append: appendArg ? Number(appendArg.split('=')[1]) : 0,
    onProgress: (p) => {
      const now = Date.now();
      if (p.phase === 'enrich' && now - lastLog < 800) return;
      lastLog = now;
      process.stdout.write(`[${String(p.phase).padEnd(7)}] ${String(p.pct ?? 0).padStart(3)}% ${p.message}\n`);
    },
  })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
