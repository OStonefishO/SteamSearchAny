// 相似度引擎：Valve 官方标签权重 × IDF → L2 归一化向量 → 余弦相似
// 多游戏输入用「融合向量 + 百分位交集」双通道打分，输入越多，结果越往交集收敛。
import { dataPath, readJson } from './store.mjs';

let state = {
  ready: false,
  games: new Map(), // appid -> record
  vectors: new Map(), // appid -> {t:Float64Array(tagIds), v:Float64Array(weights), norm}
  postings: new Map(), // tagId -> [{id, w}]
  idf: new Map(),
  tagDict: {},
  order: [], // appid 列表（稳定顺序，用于数组化运算）
  posOf: new Map(),
  loadedAt: null,
};

export function isReady() {
  return state.ready;
}

export function stats() {
  return {
    ready: state.ready,
    games: state.games.size,
    tags: Object.keys(state.tagDict).length,
    loadedAt: state.loadedAt,
  };
}

export function getGame(appid) {
  return state.games.get(Number(appid)) ?? null;
}

export function getTagDict() {
  return state.tagDict;
}

export function tagName(id) {
  return state.tagDict[String(id)]?.zh ?? `标签${id}`;
}

/** 加载语料库并预计算 IDF / 向量 / 倒排索引 */
export async function loadIndex() {
  let corpus = await readJson(dataPath('corpus.json'), null);
  if (!corpus?.games) {
    const buildState = await readJson(dataPath('build-state.json'), null);
    if (buildState?.done) {
      corpus = { games: buildState.done, tagDict: buildState.tagDict ?? {} };
    }
  }
  if (!corpus?.games) {
    state = { ...state, ready: false };
    return stats();
  }

  const games = new Map();
  for (const [k, g] of Object.entries(corpus.games)) {
    if (!g || !Array.isArray(g.tags) || !g.tags.length) continue;
    games.set(Number(k), g);
  }
  const tagDict = corpus.tagDict ?? {};

  // 文档频率
  const df = new Map();
  for (const g of games.values()) {
    const seen = new Set();
    for (const t of g.tags) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      df.set(t.id, (df.get(t.id) ?? 0) + 1);
    }
  }
  const N = Math.max(1, games.size);
  const idf = new Map();
  for (const [tid, freq] of df) idf.set(tid, Math.log(1 + N / Math.max(1, freq)));

  // 向量 + 倒排
  const vectors = new Map();
  const postings = new Map();
  const order = [];
  const posOf = new Map();
  for (const [appid, g] of games) {
    const ids = [];
    const vals = [];
    const seen = new Set();
    for (const t of g.tags) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      // Valve 权重 0~1000：加权后再乘 IDF，避免"独立/动作"这类大标签淹没个性标签
      const base = 0.25 + 0.75 * Math.min(1, Math.max(0, (t.w ?? 500) / 1000));
      const val = (idf.get(t.id) ?? 1) * base;
      ids.push(t.id);
      vals.push(val);
    }
    const norm = Math.sqrt(vals.reduce((s, v) => s + v * v, 0)) || 1;
    vectors.set(appid, { t: Float64Array.from(ids), v: Float64Array.from(vals), norm });
    for (let i = 0; i < ids.length; i += 1) {
      const tid = ids[i];
      let arr = postings.get(tid);
      if (!arr) postings.set(tid, (arr = []));
      arr.push({ id: appid, w: vals[i] });
    }
    posOf.set(appid, order.length);
    order.push(appid);
  }

  state = { ready: true, games, vectors, postings, idf, tagDict, order, posOf, loadedAt: new Date().toISOString() };
  return stats();
}

/** 单个游戏的单位向量（仅保留语料库里出现过的标签） */
function unitVector(rec, userWeight = 1) {
  const map = new Map();
  for (const t of rec.tags) {
    if (!state.idf.has(t.id)) continue;
    const base = 0.25 + 0.75 * Math.min(1, Math.max(0, (t.w ?? 500) / 1000));
    map.set(t.id, state.idf.get(t.id) * base);
  }
  let norm = 0;
  for (const v of map.values()) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  const out = new Map();
  for (const [k, v] of map) out.set(k, (v / norm) * userWeight);
  return out;
}

function centroidOf(seedUnits) {
  const sum = new Map();
  for (const unit of seedUnits) for (const [t, v] of unit) sum.set(t, (sum.get(t) ?? 0) + v);
  let norm = 0;
  for (const v of sum.values()) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  const out = new Map();
  for (const [t, v] of sum) out.set(t, v / norm);
  return out;
}

/** 用向量 × 倒排索引算全量点积，返回 Map<appid, cos> */
function scoreAgainst(unitMap) {
  const acc = new Map();
  for (const [tid, q] of unitMap) {
    if (!q) continue;
    const posting = state.postings.get(tid);
    if (!posting) continue;
    for (const { id, w } of posting) {
      acc.set(id, (acc.get(id) ?? 0) + q * w);
    }
  }
  const cos = new Map();
  for (const [appid, dot] of acc) {
    const vec = state.vectors.get(appid);
    if (!vec) continue;
    cos.set(appid, dot / vec.norm);
  }
  return cos;
}

function percentileRanks(cosMap) {
  const arr = state.order
    .map((id) => [id, cosMap.get(id) ?? 0])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = Math.max(1, arr.length);
  const pct = new Map();
  for (let i = 0; i < arr.length; i += 1) {
    pct.set(arr[i][0], 1 - i / total); // 1 = 最相似
  }
  return { pct, ranked: arr.length };
}

/**
 * 多游戏加权相似检索
 * @param {Array<{game:object, weight:number}>} seeds
 * @param {{limit?:number, exclude?:number[], tagId?:number, minReviews?:number, pool?:string}} opts
 */
export function findSimilar(seeds, opts = {}) {
  const { limit = 24, exclude = [], tagIds = [], minReviews = 0, maxReviews = 0, minPct = 0, demoMode = 'exclude' } = opts;
  const wantTags = (tagIds || []).map(Number).filter((n) => n > 0);
  if (!state.ready) return { ok: false, error: 'INDEX_NOT_READY', results: [], seeds: [] };
  if (!seeds.length) return { ok: false, error: 'NO_SEEDS', results: [], seeds: [] };

  const seedIds = new Set(seeds.map((s) => s.game.id));
  const units = seeds.map((s) => unitVector(s.game, Math.max(0.05, s.weight ?? 1)));
  const centroid = centroidOf(units);
  const single = seeds.length === 1;

  const fusionCos = scoreAgainst(centroid);
  const perSeedCos = units.map((u) => scoreAgainst(u));
  const perSeedRank = perSeedCos.map((m) => percentileRanks(m));

  const norm = (cos) => Math.max(0, Math.min(1, (cos - 0.18) / 0.62));

  const candidates = new Set(fusionCos.keys());
  const scored = [];
  for (const appid of candidates) {
    if (seedIds.has(appid)) continue;
    if (exclude.includes(appid)) continue;
    const rec = state.games.get(appid);
    if (!rec) continue;
    if (wantTags.length) {
      const have = new Set(rec.tags.map((t) => t.id));
      if (!wantTags.every((id) => have.has(id))) continue;
    }
    if (minReviews && (rec.rev?.total ?? 0) < minReviews) continue;
    if (maxReviews && (rec.rev?.total ?? 0) > maxReviews) continue;
    if (minPct && (rec.rev?.pct ?? 0) < minPct) continue;
    if (!passDemo(rec, demoMode)) continue;

    const fusion = fusionCos.get(appid) ?? 0;
    const fusionNorm = norm(fusion);

    let score;
    let fit;
    const cosList = perSeedCos.map((m) => m.get(appid) ?? 0);
    if (single) {
      // 单种子：余弦直接决定排序，百分位只用于展示
      score = fusionNorm;
      fit = perSeedRank[0].pct.get(appid) ?? 0;
    } else {
      // 多种子：融合向量 + 平均贴合 + 最弱环节（保证"同时像每一款"，而不是只像其中一款）
      const meanCos = cosList.reduce((s, v) => s + v, 0) / cosList.length;
      const minCos = Math.min(...cosList);
      const meanN = norm(meanCos);
      const minN = norm(minCos);
      score = 0.46 * fusionNorm + 0.30 * meanN + 0.24 * minN;
      fit = 0.5 * meanN + 0.5 * minN;
    }

    // 贡献标签
    const shared = [];
    for (const t of rec.tags) {
      const c = centroid.get(t.id);
      if (c) shared.push({ id: t.id, zh: tagName(t.id), v: c });
    }
    shared.sort((a, b) => b.v - a.v);

    scored.push({
      ...rec,
      url: `https://store.steampowered.com/app/${appid}/`,
      score: Number(score.toFixed(4)),
      fusion: Number(fusionNorm.toFixed(4)),
      fit: Number(fit.toFixed(4)),
      perSeed: perSeedRank.map((p) => Number(((p.pct.get(appid) ?? 0) * 100).toFixed(1))),
      seedCos: cosList.map((v) => Number(v.toFixed(3))),
      shared: shared.slice(0, 5).map((s) => s.zh),
    });
  }

  scored.sort((a, b) => b.score - a.score || (b.rev?.total ?? 0) - (a.rev?.total ?? 0));

  return {
    ok: true,
    poolMatched: scored.length,
    seeds: seeds.map((s, i) => ({
      id: s.game.id,
      name: s.game.name,
      weight: s.weight ?? 1,
      tags: s.game.tags.slice(0, 8).map((t) => tagName(t.id)),
    })),
    results: scored.slice(0, limit),
  };
}

/** 隐藏佳作评分（0~100） */
export function gemScore(rec) {
  const total = rec.rev?.total ?? 0;
  const pct = rec.rev?.pct ?? 0;
  if (total < 12 || pct <= 0) return 0;
  const quality = Math.max(0, Math.min(1, (pct - 70) / 30));
  let obscurity;
  if (total <= 120) obscurity = 1;
  else if (total <= 1000) obscurity = 1 - ((total - 120) / 880) * 0.35;
  else if (total <= 10000) obscurity = 0.65 - ((total - 1000) / 9000) * 0.35;
  else if (total <= 60000) obscurity = 0.3 - ((total - 10000) / 50000) * 0.2;
  else obscurity = 0.05;
  const year = rec.year ?? 0;
  const nowYear = new Date().getFullYear();
  const fresh = year >= nowYear - 2 ? 0.08 : year >= nowYear - 5 ? 0.04 : 0;
  return Math.round(Math.max(0, Math.min(1, 0.55 * quality + 0.45 * obscurity + fresh)) * 100);
}

export function isGem(rec, { minPct = 78, maxReviews = 60000, minReviews = 12 } = {}) {
  const total = rec.rev?.total ?? 0;
  const pct = rec.rev?.pct ?? 0;
  return total >= minReviews && total <= maxReviews && pct >= minPct;
}

const DEMO_RE = /(^|[\s:：\-–\[(])demo\b|试玩|序章|prologue|playtest/i;
export const isDemoGame = (g) => DEMO_RE.test(g?.name || '') || DEMO_RE.test(g?.alt || '');
function passDemo(g, demoMode = 'exclude') {
  if (demoMode === 'only') return isDemoGame(g);
  if (demoMode === 'all') return true;
  return !isDemoGame(g);
}

/** 盲盒候选池（tagIds 为 AND 语义：必须同时带这些标签） */
export function randomPool({ mode = 'gem', tagIds = [], minYear = null, maxYear = null, minPct = 0, demoMode = 'exclude' } = {}) {
  const want = (tagIds || []).map(Number).filter((n) => n > 0);
  const out = [];
  for (const g of state.games.values()) {
    if (want.length) {
      const have = new Set((g.tags ?? []).map((t) => t.id));
      if (!want.every((id) => have.has(id))) continue;
    }
    if (minYear && (g.year ?? 0) < minYear) continue;
    if (maxYear && (g.year ?? 9999) > maxYear) continue;
    if (!passDemo(g, demoMode)) continue;
    if (minPct && ((g.rev?.pct ?? 0) < minPct || !g.rev?.total)) continue;
    if (mode === 'gem') {
      if (!isGem(g)) continue;
    } else if (mode === 'hidden') {
      if (!isGem(g, { minPct: 80, maxReviews: 3000 })) continue;
    } else if (mode === 'fresh') {
      const nowYear = new Date().getFullYear();
      if ((g.year ?? 0) < nowYear - 2 || !isGem(g, { minPct: 70, maxReviews: 200000 })) continue;
    }
    out.push(g);
  }
  return out;
}

export function pickRandom(list, count, exclude = []) {
  const ex = new Set(exclude.map(Number));
  let pool = list.filter((g) => !ex.has(g.id));
  if (!pool.length) pool = list;
  const picked = [];
  const copy = pool.slice();
  for (let i = 0; i < count && copy.length; i += 1) {
    const idx = Math.floor(Math.random() * copy.length);
    picked.push(copy.splice(idx, 1)[0]);
  }
  return picked;
}

export function decorate(rec) {
  return {
    ...rec,
    url: `https://store.steampowered.com/app/${rec.id}/`,
    gem: gemScore(rec),
    tags: (rec.tags ?? []).slice(0, 12).map((t) => ({ id: t.id, zh: tagName(t.id), w: t.w })),
  };
}

export function topTags(limit = 60, { minCount = 20 } = {}) {
  const counts = new Map();
  for (const g of state.games.values()) for (const t of g.tags ?? []) counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([id, c]) => c >= minCount && state.tagDict[String(id)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, c]) => ({ id, zh: tagName(id), en: state.tagDict[String(id)]?.en ?? '', count: c }));
}
