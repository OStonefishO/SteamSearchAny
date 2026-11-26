# Steam 灯塔 · 找到没人注意到的那些游戏

一个本地跑的 Steam 游戏发现站，两个核心玩法：

| 玩法 | 做什么 |
| --- | --- |
| 🎲 **盲盒发现** | 每次刷新随机推一款游戏，默认只捞「评测不多、但好评率很高」的隐藏佳作，并给出冷门指数 |
| 🧭 **相似追踪** | 输入一到六款游戏（可调权重），按 Valve 官方标签权重算出「同时像它们」的作品——输入越多，结果越向交集收敛 |

数据全部来自 Steam 自己的公开接口，本地缓存成语料库，不依赖 SteamDB / SteamPeek 等第三方站点。

---

## 一、启动

双击 `start.bat`（或在 PowerShell 里 `./start.ps1`），浏览器会自动打开 <http://127.0.0.1:5173>。

手动启动也行：

```powershell
node server/index.mjs          # 默认 5173 端口，PORT=8080 可改
```

> 本项目**零依赖**，不需要 `npm install`。Node 20+ 即可。

---

## 二、页面怎么用

**盲盒发现**

- 顶部四档筛选：`隐藏佳作`（评测 12–3000 且 ≥80% 好评）、`好评小众`（≤6 万评测且 ≥78% 好评）、`这两年`、`完全随机`
- 「全部标签」下拉可以限定品类，卡片上的标签点一下也会切成该标签的盲盒
- 按 <kbd>空格</kbd> 或点「换一款」继续抽；抽过的会进「刚刚捞到」条，不会立刻重复
- 每张卡右上角是**冷门指数**（好评率 × 稀缺度 × 新鲜度），越高越"被埋没"

**相似追踪**

- 搜索框输入中英文名都行（`No Man's Sky` / `无人深空` / `饥荒`），下拉里标「需补全」的会现取现用
- 加进种子后拖动滑杆调权重：**把它拉高，结果就更像它**
- 「只看冷门」勾上后只保留评测 < 5000 的作品，专治「我要的是同类，不是同类里的爆款」
- 地址栏会自动同步成 `?ids=275850,413150&w=1,1.5`，可以直接把这串链接发给朋友

---

## 三、相似度是怎么算的（不想看可以跳过）

```
1. 每款游戏 = 一组 (标签, 权重) —— 权重直接取 Valve 商店接口返回的官方 tag weight（0–1000）
2. 特征值 = idf(标签) × (0.25 + 0.75 × 权重/1000)
   idf = log(1 + N/df)，让「独立/动作」这类烂大街标签自动降权
3. 每款游戏 L2 归一化 → 单位向量；种子按用户权重加权求和 → 归一化成「融合向量」
4. 通道一：候选 · 融合向量的余弦（像"这一组"）
   通道二：候选 · 每个种子各自余弦的平均值（像"整体"）
   通道三：候选 · 每个种子余弦的最小值（最弱环节，保证不是只像其中一款）
5. 多种子最终分 = 0.46 × 融合 + 0.30 × 平均贴合 + 0.24 × 最弱贴合
6. 用倒排索引算点积，7000 款全量比对 40–90 毫秒
```

冷门指数：

```
quality    = clamp((好评率 - 70) / 30, 0, 1)
obscurity  = 按评测数分段：≤120 → 1.0，1000 → 0.65，1 万 → 0.30，6 万 → 0.05
freshness  = 近 2 年 +0.08，近 5 年 +0.04
冷门指数   = round(0.55·quality + 0.45·obscurity + freshness)
```

---

## 四、语料库

| 项 | 值 |
| --- | --- |
| 规模 | 约 9,800 款游戏 · 428 个 Valve 官方标签 |
| 盲盒候选 | 隐藏佳作池约 2,800 款（每次刷新实时统计） |
| 字段 | 名称、标签+权重、好评率、评测数、发售年、价格、封面素材 |
| 来源 | `IStoreBrowseService/GetItems`（Valve 免 key 商店接口）+ Steam 产品库快照（枚举用） |
| 位置 | `data/corpus.json` |

**重建 / 扩量**

```powershell
# 重建语料库需要先拉一次产品库快照（28MB，不入 git）
curl.exe -L -o data/steam-db.json https://raw.githubusercontent.com/Nebukam/steam-db/master/db.json

node server/build-corpus.mjs --target=9000    # 首次建库，断点续传
node server/build-corpus.mjs --append=3500    # 在已有池子上扩量（可反复跑）
node scripts/enrich-extra.mjs                 # 补现代热作 + 月度新作榜 + 在线榜
node scripts/check-corpus.mjs                 # 体检：年份分布、评测覆盖、标签分布
node scripts/check-frontend.mjs               # 前端选择器 / class 交叉检查
node scripts/clean-years.mjs                  # 清理「未定档」占位年份
```

服务端每 30 秒检查一次 `corpus.json` 的修改时间，扩量完成后会**自动热重载**，不用重启。

**语料库外的游戏**：用户搜索时会出现「需补全」标记，服务端会现取现用并写回缓存，所以不用整库重抓。

---

## 五、HTTP 接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/status` | 语料规模、构建进度 |
| `GET /api/tags?limit=70` | 热门标签（含作品数） |
| `GET /api/search?q=stardew` | 名称检索（本地 13 万条 + 语料库本地化名） |
| `GET /api/random?mode=hidden&tag=492&exclude=1,2` | 盲盒抽取，`mode` = `hidden/gem/fresh/any` |
| `GET /api/similar?ids=275850,413150&weights=1,1.5&limit=30` | 相似检索，可加 `minReviews` / `maxReviews` / `tag` |
| `GET /api/game/275850` | 单款详情 + 6 个相近作品 |
| `POST /api/build?target=9000` | 后台续跑语料库构建 |

---

## 六、目录结构

```
steam-lighthouse/
├─ server/
│  ├─ index.mjs          HTTP 服务：静态站 + JSON API + 语料热重载
│  ├─ similar.mjs        向量、IDF、倒排索引、相似度与冷门指数
│  ├─ build-corpus.mjs   语料库构建（断点续传 / 扩量 / 按需补全）
│  ├─ steam.mjs          商店页抓取（节流、重试、UA、语言）
│  ├─ parse.mjs          商店搜索结果 HTML 解析（备用数据源）
│  └─ store.mjs          JSON 原子读写
├─ public/               前端（原生 JS，无框架无构建步骤）
├─ scripts/              体检 / 增量补全 / 年份清理 / 前端交叉检查
├─ data/                 corpus.json（语料）、build-state.json（构建进度）、steam-db.json（快照）
└─ start.bat / start.ps1
```

---

## 七、踩过的坑（留个记录）

- `store.steampowered.com` 在国内网络下会间歇性被 reset，所以数据通路换成 `api.steampowered.com/IStoreBrowseService/GetItems`——同源官方数据，稳定得多，而且一次能返回 100 款
- 标签 id → 中文名也能用同一接口查（`ids:[{tagid:492}]`），不必依赖 `tagdata/populartags`
- `.modal{display:grid}` 会盖掉 HTML 的 `hidden` 属性，必须补 `[hidden]{display:none!important}`，否则整页蒙一层黑纱
- 评测数千万的大作和 200 条评测的小品要分开排序策略，否则「相似」永远指向爆款
- Valve 对未定档游戏会返回 2099 这类占位发售年，`scripts/clean-years.mjs` 统一置空
- 中途换过数据通路：商店搜索结果里其实就带 `data-ds-tagids` 和好评率，但该域名会被 reset，所以主通路换成 API 域
