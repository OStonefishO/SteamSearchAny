// 解析 Steam 商店搜索结果的 results_html（无需第三方 DOM 库）
// 每行能拿到：appid / 标签ID / 名称 / 发售日 / 好评率 / 评测数 / 价格 / 平台 / 胶囊图

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

export function decodeEntities(str = '') {
  return str
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

export function cleanText(str = '') {
  return decodeEntities(String(str).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(str, re) {
  const m = str.match(re);
  return m ? m[1] : null;
}

function parseIntSafe(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d]/g, ''));
  return Number.isFinite(n) && String(v).trim() !== '' ? n : null;
}

/**
 * @param {string} html results_html
 * @returns {Array<object>} 游戏记录
 */
export function parseSearchRows(html = '') {
  const out = [];
  const chunks = html.split('<a ');
  for (const chunk of chunks) {
    if (!chunk.includes('data-ds-appid')) continue;

    const appid = parseIntSafe(pick(chunk, /data-ds-appid="(\d+)/));
    if (!appid) continue;

    // 标签
    const tagRaw = pick(chunk, /data-ds-tagids="\[([^\]]*)\]/);
    const tags = tagRaw
      ? tagRaw
          .split(',')
          .map((s) => parseIntSafe(s))
          .filter((n) => Number.isFinite(n) && n > 0)
      : [];

    // 名称
    const name = cleanText(
      pick(chunk, /<span class="title">([\s\S]*?)<\/span>/) ??
        pick(chunk, /<span class="search_name"[^>]*>([\s\S]*?)<\/span>/) ??
        ''
    );

    // 发售日
    const releasedRaw = cleanText(
      pick(chunk, /class="col search_released[^"]*"[^>]*>([\s\S]*?)<\/div>/) ?? ''
    );
    const yearMatch = releasedRaw.match(/(\d{4})/);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    const comingSoon = /即将推出|即将發行|Coming soon|To be announced/i.test(releasedRaw);

    // 评测
    const reviewClass = pick(chunk, /class="search_review_summary ([a-z_]+)"/) || null;
    const tooltip = decodeEntities(pick(chunk, /data-tooltip-html="([\s\S]*?)"\s*>/) ?? '');
    const label = cleanText(tooltip.split(/<br\s*\/?>/i)[0] || '');
    const totalMatch =
      tooltip.match(/([\d,]+)\s*篇用户评测/) || tooltip.match(/([\d,]+)\s*user reviews/i);
    const pctMatch = tooltip.match(/(\d+)\s*%\s*(?:为好评|of the[\s\S]*?positive)/i) ||
      tooltip.match(/好评率\s*(\d+)\s*%/);
    const revTotal = totalMatch ? parseIntSafe(totalMatch[1]) : null;
    const revPct = pctMatch ? Number(pctMatch[1]) : null;

    // 价格
    const finalPrice = cleanText(
      pick(chunk, /class="discount_final_price"[^>]*>([\s\S]*?)<\/div>/) ??
        pick(chunk, /class="search_price[^"]*"[^>]*>([\s\S]*?)<\/div>/) ??
        ''
    );
    const originalPrice = cleanText(
      pick(chunk, /class="discount_original_price"[^>]*>([\s\S]*?)<\/div>/) ?? ''
    );
    const discountPct = parseIntSafe(pick(chunk, /class="discount_pct"[^>]*>([\s\S]*?)<\/div>/));

    // 平台
    const plat = [];
    const platRe = /class="platform_img ([a-z]+)/g;
    let pm;
    while ((pm = platRe.exec(chunk))) plat.push(pm[1]);

    // 图
    const img = pick(chunk, /<img src="([^"]+)"/);

    out.push({
      id: appid,
      name,
      tags,
      year,
      comingSoon,
      released: releasedRaw || null,
      rev: revTotal != null || revPct != null
        ? { label: label || null, total: revTotal, pct: revPct, cls: reviewClass }
        : null,
      price: finalPrice || null,
      originalPrice: originalPrice || null,
      discountPct: discountPct || null,
      free: /免费|Free/i.test(finalPrice || ''),
      plat,
      img: img || null,
    });
  }
  return out;
}

/** 从商店页 HTML 抓标签名 + og:image（用于语料库之外的游戏） */
export function parseStorePageTags(html = '') {
  const names = [];
  const re = /class="app_tag"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const t = cleanText(m[1]);
    if (t && t !== '+' && !names.includes(t)) names.push(t);
  }
  const title = cleanText(
    pick(html, /<div id="appHubAppName"[^>]*>([\s\S]*?)<\/div>/) ?? pick(html, /<title>([\s\S]*?)<\/title>/) ?? ''
  );
  const ogImage = pick(html, /property="og:image"\s+content="([^"]+)"/);
  return { names, title, ogImage };
}
