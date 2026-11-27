[English](./README.en.md) | **简体中文**

[![Live](https://img.shields.io/badge/live-ostonefisho.github.io-45bdf7)](https://ostonefisho.github.io/SteamSearchAny-web/)
[![Stars](https://img.shields.io/github/stars/OStonefishO/SteamSearchAny?style=social)](https://github.com/OStonefishO/SteamSearchAny/stargazers)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Games](https://img.shields.io/badge/%E8%AF%AD%E6%96%99-11%2C700%2B%20%E6%AC%BE-blueviolet)](#数据)
# Steam 灯塔 · Steam Lighthouse

> **在线使用**：<https://ostonefisho.github.io/SteamSearchAny-web/>
> 在近万款 Steam 游戏里，捞出没人注意到的那些。纯静态、打开即用、无需注册。

一个 Steam 游戏发现站，两个玩法：

| | 做什么 | 怎么算 |
| --- | --- | --- |
| 🎲 **盲盒发现** | 一屏随机推 33 款游戏，默认只捞「评测不多、但好评率很高」的隐藏佳作 | 冷门指数 = 好评质量 × 评测稀缺度 × 新鲜度 |
| 🧭 **相似追踪** | 输入 1–6 款游戏各带权重，推荐「同时像它们」的作品 | Valve 官方标签权重 × IDF 余弦 + 多通道融合 |

理念参考 [SteamPeek](https://steampeek.hu/)（归一化标签向量 + 相似度检索），但用的是 Valve 接口返回的**官方 tag weight**（0–1000），并额外做了去重与质量加权。

---

## 功能一览

**盲盒发现**
- 四档模式：隐藏佳作 / 好评小众 / 这两年 / 完全随机
- 筛选：标签（**多选，AND 语义**）、好评率下限、**Demo 三态**（不含 / 只看 / 全部）、**发售日期区间**（精确到日）
- 每张卡右上角 **ⓘ** 打开游戏资料面板：简介、开发商/发行商、好评率、评测数、发售年、价格、标签、系统需求、Steam/YouTube 外链
- 鼠标悬停 260ms 浮现信息卡（宣传图 + 简介 + 指标 + 标签）
- 空格键换一批，抽过的进「刚刚捞到」不会立刻重复

**相似追踪**
- 多款种子 + 每款独立权重（0×–3×，0 = 忽略该种子）
- 条件：最低评测数、最高评测数、最低好评率
- 结果在分数邻域内随机打散，每次「找相似」都会换一批同档作品
- 地址栏同步 `?ids=275850,413150&w=1,1.5`，可直接分享；`?game=<appid>` / `?info=<appid>` 深链

**通用**
- ⚙ 显示设置：每屏款数（8–48）、每页款数（18–90）、卡片尺寸四档，记在 localStorage
- 页脚「更新日志」：每天自动更新的记录表

---

## 相似度算法

```
特征值 = idf(标签) × (0.25 + 0.75 × 官方权重/1000)
idf   = log(1 + N/df)            ← 让「独立/动作」这类大标签自动降权
种子向量 = 每款游戏 L2 归一化后按用户权重求和，再归一化（融合向量）

单种子：score = 融合余弦（线性映射到 0–1）
多种子：score = 0.46 × 融合余弦 + 0.30 × 各种子平均贴合 + 0.24 × 最弱环节贴合
```

在此之上的四道处理：

1. **剔除万金油标签**：出现率 > 22% 的标签不进入种子向量（否则「单人/独立」会淹掉「太空模拟/基地建设」）
2. **MMR 去重**：新结果与已选结果共享 ≥2 个 top-3 标签就跳过，保证列表有不同风味
3. **好评率轻加权**：`score × (0.88 + 0.12 × 好评率)`，同分时口碑好的上浮（不是硬过滤）
4. **同分随机化**：`score ± 11%` 抖动，每次检索换一批"同样好"的作品

性能：11,000+ 款全量比对，倒排索引 + Float64 累加，**15–20 ms**。

冷门指数：

```
quality    = clamp((好评率 - 70) / 30, 0, 1)
obscurity  = 分段：≤120 评 → 1.0，1000 评 → 0.65，1 万 → 0.30，6 万 → 0.05
freshness  = 近 2 年 +0.08，近 5 年 +0.04
冷门指数   = round(0.55·quality + 0.45·obscurity + freshness)
```

---

## 数据

| 项 | 值 |
| --- | --- |
| 规模 | **11,600+ 款**游戏 · **428** 个 Valve 官方标签 |
| 字段 | 名称（中/英）、标签+权重、好评率、评测数、发售时间戳、价格、简介、开发商/发行商、封面 |
| 来源 | `IStoreBrowseService/GetItems`（Valve 免 key 接口）+ [steam-db](https://github.com/Nebukam/steam-db) 快照（仅用于枚举 appid） |
| 更新 | 每天 03:10 UTC（北京时间 11:10）由 **GitHub Actions** 抓取新游并入；本机另有计划任务做备份补抓 |

**为什么不抓商店页**：`store.steampowered.com` 在部分网络下会被重置，而 `api.steampowered.com` 稳定得多，且一次能返回 100 款游戏的完整标签权重。

---

## 跑起来

```powershell
node server/index.mjs          # 本地开发服务 http://127.0.0.1:5173
```

零依赖，不需要 `npm install`，Node 20+ 即可。也可以直接双击 `start.bat`。

**构建静态站 / 发布**

```powershell
node scripts/build-static.mjs   # 生成 dist/（含 60 个标签页 + 300 个游戏页 + sitemap）
.\scripts\update-online.ps1     # 抓新游 → 合并云端新增 → 重建 → 推送到站点仓库
```

**桌面客户端**：`client/out/SteamSearchAny.exe`（约 2.6 MB，内嵌整站 + 本地 HTTP 服务，双击即用）

---

## 目录

```
server/      Node 服务：静态托管 + JSON API + 相似度引擎 + 语料构建
public/      前端（原生 JS / 无框架 / 无构建步骤）
scripts/     构建、抓取、回填、体检、发布脚本
client/      桌面客户端（C# launcher，csc 编译，无运行时依赖）
data/        corpus.json（语料）· changelog.json（更新日志）· vision.json（封面特征）
```

前端通过 `public/local-api.js` 接管 `fetch('/api/*')`，把相似度引擎整体搬到浏览器里 —— 所以**同一套代码既能跑 Node 服务，也能纯静态托管**，线上版就是后者。

---

## SEO

站点专为可被搜索到做了准备：`robots.txt` + `sitemap.xml`（360+ URL）+ 每页独立 `<title>/<meta>` + JSON-LD（WebApplication）+ `<noscript>` 静态正文 + Open Graph 分享图。每次更新会向 IndexNow（Bing / Yandex 等）提交变更。

---

## 已知限制

- 系统需求（最低配置）字段尚未抓取，资料面板显示占位 —— 需要逐款调 `appdetails`，计划每天补 300–400 款
- 封面特征（`vision.json`，约 75% 覆盖）仅用于同分微调，不参与主排序
- Google / 百度收录需自行在 Search Console / 站长平台提交 sitemap

---

## 致谢

- 数据：[Valve Steam Web API](https://steamcommunity.com/dev)
- 枚举快照：[Nebukam/steam-db](https://github.com/Nebukam/steam-db)
- 西文字体：[Inter](https://rsms.me/inter/)（SIL OFL）

MIT License · make with ♥ love by [@OStonefishO](https://github.com/OStonefishO)
