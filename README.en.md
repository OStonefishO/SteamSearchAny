# Steam Lighthouse · Steam 灯塔

**English** | [简体中文](./README.md)

> **Live site**: <https://ostonefisho.github.io/SteamSearchAny-web/>
> Find the games nobody else is looking at — 11,700+ titles, no sign-up, opens instantly.

A Steam game-discovery website with two ways to play:

| | What it does | How it works |
| --- | --- | --- |
| 🎲 **Blind box** | Rolls 33 games at once, defaulting to "few reviews, very high rating" hidden gems | Gem score = review quality × obscurity × freshness |
| 🧭 **Similarity** | Give it 1–6 seed games with per-seed weights, get games that sit in their intersection | Valve official tag weights × IDF cosine + multi-seed fusion |

The idea follows [SteamPeek](https://steampeek.hu/) (normalised tag vectors), but we use Valve's **official tag weights** (0–1000) returned by their API, plus de-duplication and quality weighting on top.

---

## Features

**Blind box**
- Four modes: hidden gems / well-rated niche / recent two years / fully random
- Filters: tags (**multi-select, AND**), minimum positive-review ratio, **demo state** (exclude / only / all), **release date range** (exact to the day)
- **ⓘ** on every card opens a detail panel: description, developer/publisher, review ratio, review count, release year, price, tags, system requirements, Steam & YouTube links
- Hover tooltip after 260 ms (cover, description, metrics, tags)
- Spacebar re-rolls; recently seen games are excluded from the next draw

**Similarity**
- Multiple seeds, each with an independent weight (0×–3×, 0 = ignore this seed)
- Filters: min reviews, max reviews, min positive-review ratio
- Results are randomly jittered inside their score neighbourhood, so every run shows a different set of equally-good games
- The URL mirrors your query (`?ids=275850,413150&w=1,1.5`) and can be shared

**Everything else**
- ⚙ Display settings: cards per screen (8–48), per page (18–90), four card sizes — remembered locally
- **Steam Now** page: current sales, new releases, upcoming titles, re-ranked by our gem score. Hidden-gem discounts first — that's the difference from a plain store page
- **HOT** badge for anything above 10,000 reviews (no more calling Baldur's Gate 3 "obscure"), plus a "hide popular" toggle in both views
- Changelog in the footer, updated daily

---

## The similarity algorithm

```
weight  = idf(tag) × (0.25 + 0.75 × official_weight / 1000)
idf     = log(1 + N / df)          ← common tags like "Indie" get pushed down automatically
seed vector = each game L2-normalised, summed by user weight, then re-normalised

single seed : score = fusion cosine (mapped to 0–1)
multi seed  : score = 0.46 × fusion + 0.30 × mean per-seed fit + 0.24 × worst per-seed fit
```

Four post-processing steps:

1. **Strip generic tags** — tags present in more than 22 % of the corpus never enter the seed vector
2. **MMR de-duplication** — a candidate sharing ≥ 2 of the top-3 tags with an already-picked result is skipped, so the list has variety
3. **Quality nudge** — `score × (0.88 + 0.12 × positive_ratio)`; a soft boost, not a hard filter
4. **Neighbourhood jitter** — ±11 % randomisation so repeated searches surface different games

Performance: full scan over 11,000+ games via an inverted index and Float64 accumulation — **15–20 ms**.

Gem score:

```
quality   = clamp((positive_ratio - 70) / 30, 0, 1)
obscurity = ≤120 reviews → 1.0 · ≤1000 → 0.65 · ≤5000 → 0.30 · ≤10000 → 0.05 · above → 0
freshness = released within 2 years +0.08, within 5 years +0.04
gem       = round(100 × (0.55·quality + 0.45·obscurity + freshness))
```

---

## Data

| Item | Value |
| --- | --- |
| Corpus | **11,700+** games · **428** official Valve tags |
| Fields | name (zh/en), tags + weights, positive ratio, review count, release timestamp, price, description, developer/publisher, cover |
| Source | `IStoreBrowseService/GetItems` (keyless Valve endpoint) + [steam-db](https://github.com/Nebukam/steam-db) snapshot for appid enumeration |
| Refresh | Daily at 03:10 UTC by **GitHub Actions**; a local scheduled task backfills as well |

**Why not scrape the store pages**: `store.steampowered.com` is frequently reset from some networks, while `api.steampowered.com` is stable and returns full tag weights for 100 games per request.

---

## Run it

```bash
node server/index.mjs          # local dev server at http://127.0.0.1:5173
```

Zero dependencies — no `npm install` needed, Node 20+ is enough.

**Build / publish the static site**

```bash
node scripts/build-static.mjs   # emits dist/ (60 tag pages + 300 game pages + sitemap)
./scripts/update-online.ps1     # fetch new games → merge → rebuild → push to the site repo
```

**Desktop client**: `client/out/SteamSearchAny.exe` (~5.5 MB, embeds the whole site and serves it locally, double-click to run)

---

## Layout

```
server/      Node service: static hosting + JSON API + similarity engine + corpus builder
public/      Frontend (vanilla JS, no framework, no build step)
scripts/     Build, sync, backfill, audit and deployment scripts
client/      Desktop client (C# launcher, compiled with csc, no runtime dependencies)
data/        corpus.json · changelog.json · vision.json
```

The frontend intercepts `fetch('/api/*')` in `public/local-api.js`, moving the whole similarity engine into the browser — so **the same code runs both as a Node service and as a purely static site**. The live site is the latter.

---

## SEO

`robots.txt` + `sitemap.xml` (360+ URLs) + per-page `<title>/<meta>` + JSON-LD (WebApplication) + `<noscript>` static content + Open Graph image. Every deployment submits changes to IndexNow (Bing / Yandex).

---

## Known limitations

- System requirements are backfilled gradually via daily `appdetails` calls (a few hundred per day)
- Cover art features (`vision.json`, ~75 % coverage) are only used as a tie-breaker between near-equal scores
- Google / Baidu indexing needs a manual sitemap submission in their webmaster consoles

---

## Credits

- Data: [Valve Steam Web API](https://steamcommunity.com/dev)
- Appid snapshot: [Nebukam/steam-db](https://github.com/Nebukam/steam-db)
- Typeface: [Inter](https://rsms.me/inter/) (SIL OFL)

MIT License · make with ♥ love by [@OStonefishO](https://github.com/OStonefishO)
