// Steam 上游抓取层：统一 UA / 语言 / 节流 / 重试 / 超时
// 全部走商店公开接口，不需要 API Key。
import { setTimeout as delay } from 'node:timers/promises';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Safari/537.36';

const BASE_HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/json,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
  // 绕过成人内容/年龄墙，保证标签完整
  Cookie: 'wants_mature_content=1; birthtime=568022401; lastagecheckage=1-0-1990; Steam_Language=schinese',
};

let lastStart = 0;
let inflight = 0;
const MAX_INFLIGHT = 3;
const MIN_GAP_MS = 110;

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

async function gate() {
  while (inflight >= MAX_INFLIGHT) await delay(30);
  const wait = MIN_GAP_MS - (Date.now() - lastStart);
  if (wait > 0) await delay(wait);
  lastStart = Date.now();
  inflight += 1;
}

/**
 * 抓取一个 URL。
 * @param {string} url
 * @param {{json?:boolean, timeout?:number, retries?:number, headers?:Record<string,string>}} [opts]
 */
export async function steamFetch(url, opts = {}) {
  const { json = false, timeout = 25000, retries = 3, headers = {} } = opts;
  let attempt = 0;
  let lastErr;

  while (attempt <= retries) {
    await gate();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { ...BASE_HEADERS, ...headers },
        signal: ctrl.signal,
        redirect: 'follow',
      });
      if (res.status === 429 || res.status === 503) {
        throw new HttpError(`rate limited (${res.status})`, res.status);
      }
      if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
      const text = (await res.text()).replace(/^\uFEFF/, '');
      return json ? JSON.parse(text) : text;
    } catch (err) {
      lastErr = err;
      if (err.name === 'AbortError') lastErr = new HttpError('timeout', 408);
      const status = lastErr?.status ?? 0;
      // 真正的 4xx（非 429）不重试
      if (status >= 400 && status < 500 && status !== 429 && status !== 408) break;
      await delay(350 * 2 ** attempt + Math.random() * 250);
    } finally {
      clearTimeout(timer);
      inflight -= 1;
    }
    attempt += 1;
  }
  throw lastErr ?? new HttpError('fetch failed', 500);
}

/** 商店搜索结果的 JSON 形态（含 results_html） */
export function searchResultsUrl({ tag, start = 0, count = 100, sortBy = '_ASC', query = '', extra = {} }) {
  const p = new URLSearchParams({
    start: String(start),
    count: String(count),
    dynamic_data: '',
    sort_by: sortBy,
    snr: '1_7_7_230_7',
    infinite: '1',
    l: 'schinese',
    cc: 'CN',
  });
  if (tag) p.set('tags', String(tag));
  if (query) p.set('query', query);
  for (const [k, v] of Object.entries(extra)) if (v != null) p.set(k, String(v));
  return `https://store.steampowered.com/search/results/?${p.toString()}`;
}

/** 关键词补全：返回 [{id, name, img, price}] */
export async function storeSearch(term) {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=schinese&cc=CN`;
  const data = await steamFetch(url, { json: true, retries: 1 });
  const items = Array.isArray(data?.items) ? data.items : [];
  return items
    .filter((it) => it.type === 'app' || it.type === 'bundle' || !it.type)
    .map((it) => ({
      id: Number(it.id),
      name: String(it.name || '').trim(),
      img: it.tiny_image || headerImg(it.id),
      price: it.price?.final != null ? (it.price.final === 0 ? '免费' : `¥ ${(it.price.final / 100).toFixed(0)}`) : null,
      platforms: it.platforms || {},
      metascore: it.metascore || null,
    }));
}

/** 标签字典：Steam 官方热门标签表 */
export async function fetchTagCatalog(lang = 'schinese') {
  const url = `https://store.steampowered.com/tagdata/populartags/${lang}`;
  const rows = await steamFetch(url, { json: true, retries: 3 });
  if (!Array.isArray(rows)) throw new HttpError('bad tag catalog', 500);
  return rows.map((r) => ({ id: Number(r.tagid), name: String(r.name || '').trim() }));
}

/** 商店详情（含简介、截图、类型、分类、发售日、评测） */
export async function appDetails(appid) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=schinese&cc=CN`;
  const data = await steamFetch(url, { json: true, retries: 2 });
  const node = data?.[String(appid)];
  if (!node?.success) throw new HttpError(`appdetails ${appid} unavailable`, 404);
  return node.data;
}

/** 商店页面 HTML（用于解析标签、og:image） */
export async function appPage(appid) {
  return steamFetch(`https://store.steampowered.com/app/${appid}/?l=schinese&cc=CN`);
}

export function headerImg(appid) {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
}
export function capsuleImg(appid) {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg`;
}
export function libraryImg(appid) {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`;
}
export function storeUrl(appid) {
  return `https://store.steampowered.com/app/${appid}/`;
}
