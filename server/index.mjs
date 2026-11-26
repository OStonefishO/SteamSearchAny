// Steam 灯塔 · 服务端（零依赖）
// 静态站 + JSON API + 相似度检索 + 盲盒抽取 + 按需补全
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import { dataPath, readJson } from './store.mjs';
import {
  loadIndex,
  stats,
  getGame,
  findSimilar,
  randomPool,
  pickRandom,
  decorate,
  gemScore,
  topTags,
  tagName,
} from './similar.mjs';
import { enrichAppIds, buildCorpus } from './build-corpus.mjs';

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ---------- 名称索引（含快照里的 8 万+ 未补全条目，保证搜得到） ----------
let nameIndex = null;
let nameIndexLoading = null;

async function ensureNameIndex() {
  if (nameIndex) return nameIndex;
  if (nameIndexLoading) return nameIndexLoading;
  nameIndexLoading = (async () => {
    const snap = await readJson(dataPath('steam-db.json'), null);
    const map = new Map();
    if (snap) {
      for (const a of Object.values(snap)) {
        if (!a?.appid || !a.name || a.name.length < 2) continue;
        if (a.parentappid) continue;
        map.set(Number(a.appid), String(a.name));
      }
    }
    // 语料库里的本地化名称优先
    nameIndex = map;
    return map;
  })();
  return nameIndexLoading;
}

async function searchGames(q, limit = 12) {
  const query = String(q || '').trim().toLowerCase();
  if (!query) return [];
  const hits = new Map(); // id -> {id, name, inCorpus, rank, len}

  const consider = (id, name, inCorpus) => {
    if (!name) return;
    const lower = name.toLowerCase();
    let rank;
    if (lower === query) rank = 0;
    else if (lower.startsWith(query)) rank = 1;
    else if (lower.includes(query)) rank = 2;
    else return; // 没命中就不收
    const prev = hits.get(id);
    const item = { id, name, inCorpus, rank, len: name.length };
    if (!prev) hits.set(id, item);
    else {
      // 保留更好的排序位次 / 本地化名称
      if (item.rank < prev.rank) prev.rank = item.rank;
      if (inCorpus && !prev.inCorpus) {
        prev.inCorpus = true;
        prev.name = name;
      }
      prev.len = Math.min(prev.len, item.len);
    }
  };

  // 本地化名 + 官方英文名（语料库优先展示）
  for (const [id] of (await ensureNameIndex())) {
    const rec = getGame(id);
    if (!rec) continue;
    consider(id, rec.name, true);
    if (rec.en) consider(id, rec.en, true);
  }
  // 英文/快照名（覆盖语料库外的 13 万条）
  const idx = await ensureNameIndex();
  for (const [id, name] of idx) consider(id, name, Boolean(getGame(id)));

  return [...hits.values()]
    .sort((a, b) => a.rank - b.rank || Number(b.inCorpus) - Number(a.inCorpus) || a.len - b.len)
    .slice(0, limit);
}

function json(res, body, status = 200) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(data);
}

async function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const buf = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      // 本地服务是开发用：脚本样式一律重新校验，避免改了前端看不到效果
      'Cache-Control': ext === '.woff2' || ext === '.jpg' || ext === '.png' ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
}

// ---------- 种子游戏解析（语料库外按需补全） ----------
async function resolveSeeds(ids) {
  const resolved = [];
  const unresolved = [];
  const missing = ids.filter((id) => !getGame(id));
  if (missing.length) {
    try {
      await enrichAppIds(missing, { retries: 2 });
    } catch {
      /* 网络窗口不通时静默，下面统一报告 */
    }
  }
  for (const id of ids) {
    const rec = getGame(id);
    if (rec) resolved.push(rec);
    else unresolved.push(id);
  }
  return { resolved, unresolved };
}

const buildStatus = { running: false, last: null };

async function statusPayload() {
  const buildState = await readJson(dataPath('build-state.json'), null);
  return {
    ok: true,
    index: stats(),
    build: {
      inProcess: buildStatus.running,
      planned: buildState?.appids?.length ?? 0,
      fetched: buildState ? Object.keys(buildState.done ?? {}).length : 0,
      finished: Boolean(buildState?.finished),
      startedAt: buildState?.createdAt ?? null,
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    if (p === '/api/health') {
      return json(res, { ok: true, uptime: process.uptime() });
    }

    if (p === '/api/status') {
      return json(res, await statusPayload());
    }

    if (p === '/api/tags') {
      const limit = Math.min(400, Number(url.searchParams.get('limit')) || 80);
      return json(res, { ok: true, tags: topTags(limit) });
    }

    if (p === '/api/search') {
      const q = url.searchParams.get('q') ?? '';
      const limit = Math.min(30, Number(url.searchParams.get('limit')) || 12);
      const items = await searchGames(q, limit);
      return json(res, { ok: true, items });
    }

    if (p === '/api/random') {
      const mode = url.searchParams.get('mode') || 'gem';
      const tagIds = (url.searchParams.get('tags') || url.searchParams.get('tag') || '')
        .split(',')
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
      const count = Math.min(48, Number(url.searchParams.get('count')) || 1);
      const exclude = (url.searchParams.get('exclude') || '')
        .split(',')
        .map(Number)
        .filter(Boolean);
      const minYear = Number(url.searchParams.get('minYear')) || null;
      const minPct = Number(url.searchParams.get('minPct')) || 0;
      const demoMode = url.searchParams.get('demo') || 'exclude';

      const pool = randomPool({ mode, tagIds, minYear, minPct, demoMode });
      if (!pool.length) return json(res, { ok: true, poolSize: 0, items: [] });
      const picked = pickRandom(pool, count, exclude);
      return json(res, {
        ok: true,
        poolSize: pool.length,
        mode,
        tags: tagIds.map((id) => ({ id, zh: tagName(id) })),
        items: picked.map(decorate),
      });
    }

    if (p === '/api/similar') {
      const ids = (url.searchParams.get('ids') || '')
        .split(',')
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0)
        .slice(0, 8);
      if (!ids.length) return json(res, { ok: false, error: 'NO_IDS' }, 400);
      const weightRaw = (url.searchParams.get('weights') || '').split(',').map(Number);
      const limit = Math.min(120, Number(url.searchParams.get('limit')) || 24);
      const tagParam = url.searchParams.get('tags') || url.searchParams.get('tag');
      const minReviews = Number(url.searchParams.get('minReviews')) || 0;
      const maxReviews = Number(url.searchParams.get('maxReviews')) || 0;

      const { resolved, unresolved } = await resolveSeeds(ids);
      if (!resolved.length) {
        return json(
          res,
          { ok: false, error: 'SEEDS_UNRESOLVED', unresolved, hint: '语料库与 Valve 接口都没能取到这些游戏的标签，请开代理后重试' },
          503
        );
      }
      const seeds = resolved.map((rec) => {
        const w = weightRaw[ids.indexOf(rec.id)];
        return { game: rec, weight: Number.isFinite(w) && w > 0 ? w : 1 };
      });
      const t0 = Date.now();
      const result = findSimilar(seeds, {
        limit,
        tagIds: (tagParam || '')
          .split(',')
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0),
        minReviews,
        maxReviews,
        minPct: Number(url.searchParams.get('minPct')) || 0,
        demoMode: url.searchParams.get('demo') || 'exclude',
      });
      return json(res, {
        ...result,
        unresolved,
        tookMs: Date.now() - t0,
        indexSize: stats().games,
        seedCards: resolved.map((rec) => decorate(rec)),
      });
    }

    if (p.startsWith('/api/game/')) {
      const id = Number(p.split('/')[3]);
      if (!Number.isFinite(id)) return json(res, { ok: false, error: 'BAD_ID' }, 400);
      let rec = getGame(id);
      if (!rec) {
        try {
          await enrichAppIds([id], { retries: 2 });
        } catch {
          /* ignore */
        }
        rec = getGame(id);
      }
      if (!rec) return json(res, { ok: false, error: 'NOT_FOUND' }, 404);
      const related = findSimilar([{ game: rec, weight: 1 }], { limit: 6 }).results;
      return json(res, { ok: true, game: decorate(rec), related });
    }

    if (p === '/api/reload') {
      const s = await loadIndex();
      return json(res, { ok: true, index: s });
    }

    if (p === '/api/build') {
      if (buildStatus.running) return json(res, { ok: true, started: false, message: '已在构建中' });
      buildStatus.running = true;
      const target = Number(url.searchParams.get('target')) || 9000;
      buildCorpus({
        target,
        onProgress: (prog) => {
          buildStatus.last = prog;
          if (prog.phase === 'done') {
            buildStatus.running = false;
            loadIndex().catch(() => {});
          }
        },
      })
        .then(() => {
          buildStatus.running = false;
          return loadIndex();
        })
        .catch((e) => {
          buildStatus.running = false;
          buildStatus.last = { phase: 'error', message: e.message };
        });
      return json(res, { ok: true, started: true });
    }

    if (p.startsWith('/api/')) return json(res, { ok: false, error: 'UNKNOWN_ENDPOINT' }, 404);

    return await serveStatic(req, res, p);
  } catch (err) {
    console.error('[api]', p, err?.message);
    if (!res.headersSent) json(res, { ok: false, error: 'INTERNAL', message: err?.message }, 500);
    else res.end();
  }
});

// ---------- 启动 ----------
let corpusMtime = 0;
async function corpusStamp() {
  try {
    const st = await fs.stat(dataPath('corpus.json'));
    return st.mtimeMs;
  } catch {
    return 0;
  }
}

(async () => {
  const s = await loadIndex();
  corpusMtime = await corpusStamp();
  // 语料库被后台扩量后自动热重载，不用重启服务
  setInterval(async () => {
    if (buildStatus.running) return;
    const m = await corpusStamp();
    if (m && m > corpusMtime) {
      corpusMtime = m;
      try {
        const next = await loadIndex();
        console.log(`[reload] 语料库已更新：${next.games} 款 · ${next.tags} 标签`);
      } catch (e) {
        console.log('[reload] 失败：', e.message);
      }
    }
  }, 30000).unref();
  server.listen(PORT, () => {
    const bar = '─'.repeat(46);
    console.log(`\n${bar}`);
    console.log('  Steam 灯塔  ·  Lighthouse for Steam');
    console.log(`  地址   http://127.0.0.1:${PORT}`);
    console.log(`  语料   ${s.games} 款游戏 · ${s.tags} 个标签`);
    console.log(`${bar}\n`);
    if (!s.ready || s.games < 800) {
      console.log('[boot] 语料库偏小，后台开始构建（可续跑）…');
      buildStatus.running = true;
      buildCorpus({
        target: 9000,
        onProgress: (prog) => {
          buildStatus.last = prog;
          if (prog.phase === 'done' || prog.phase === 'error') buildStatus.running = false;
        },
      })
        .then(() => loadIndex())
        .catch((e) => {
          buildStatus.running = false;
          console.log('[boot] 构建中断：', e.message);
        });
    }
    ensureNameIndex().catch(() => {});
  });
})();

process.on('unhandledRejection', (e) => console.error('[unhandled]', e?.message ?? e));
