<!-- memory-created: 2026-11-26 18:42:07 -->
<!-- memory-updated: 2026-11-26 21:46:53 -->
<!-- memory-slug: steamsearchany | cwd: D:\综合创作 -->

# 记忆 · Steam 灯塔 / SteamSearchAny 建站与上线

> 本文件由 `memoryforlongtxt` skill 维护：会话开头创建，之后每轮把新事实追加进来；上下文吃紧、换会话、或用户说"接着上次"时，读它恢复现场。

| 字段 | 值 |
| --- | --- |
| 记忆文件 | `D:\AiMemory\2026-11\20261126-184207-steamsearchany.md` |
| 会话开始 | 2026-11-26 18:42:07 |
| 工作目录 | `D:\综合创作` |
| 状态 | 进行中 |
| 分区 7 是恢复现场的第一入口 | 每次收尾务必更新 |

## 1. 用户与偏好

- 称呼：主人 / 宝宝
- 语言：简体中文
- 语气：猫娘系，撒娇 + 直接给活
- 已知环境（路径 / 工具 / 版本）：
- **[18:53:12]** 用户称呼助手为主人，中文对话，要结果不要解释性废话；重视可验证的实证（截图/接口自检）。GitHub 账号 OStonefishO，gh CLI 已登录（repo scope）。

## 2. 本次会话目标

- 主目标：
- 子目标：
- 验收标准（可测）：
- **[18:53:12]** 目标：Steam 游戏发现站（随机盲盒 + 多游戏加权相似检索）→ 私有仓库 SteamSearchAny → 永久线上网址 + 桌面客户端 exe + 网址发手机 + 本记忆文件。

## 3. 事实与决定（时间线）

<!-- 追加格式：- **[HH:mm:ss]** 内容 -->
- **[18:53:13]** 数据通路：store.steampowered.com 被间歇 reset，改用 api.steampowered.com/IStoreBrowseService/GetItems（免 key，一次 100 款，返回官方 tag weight/好评率/评测数/发售日/素材）。
- **[18:53:13]** 语料：9814 款游戏 / 428 个 Valve 官方标签；来自 Nebukam/steam-db 快照抽样 + GetItems 补全，断点续传。
- **[18:53:13]** 相似度：idf(标签)x(0.25+0.75x官方权重/1000) → L2 归一 → 多种子 0.46*融合余弦 + 0.30*平均贴合 + 0.24*最弱环节；服务端全量 49-108ms。
- **[18:53:14]** GitHub Pages 在私有仓库不可用（API 返回 422 plan 限制），因此另建公开产物仓库 SteamSearchAny-web 只放构建产物；源码仓库仍私有。
- **[18:53:14]** 静态版方案：把相似度引擎搬进浏览器（public/local-api.js 接管 window.fetch 的 /api/*），dist/ 纯静态，无需后端。
- **[18:53:14]** 客户端：client/Launcher.cs 用 .NET Framework csc 编译成 winexe，内嵌 site.zip，运行时解到 C:\Users\MECHREVO\AppData\Local\\SteamLighthouse，用 TcpListener 自建极简 HTTP（避开 HttpListener 的 URL ACL 需管理员问题）。
- **[18:53:15]** 踩坑：.modal{display:grid} 会压掉 [hidden]，必须 [hidden]{display:none!important}；Valve 对未定档游戏返回 2099 占位年份，用 scripts/clean-years.mjs 置空。
- **[20:19:28]** UI v2（2026-11-26 20:20）：重写 style.css 视觉系统，自托管 Inter woff2，卡片改密网格 auto-fill minmax(126px)（1440 宽 9 列），盲盒页一次 33 款（1 主卡 + 32 网格），相似页一页 45 款 + 加载更多；相似分用蓝色实心角标、好评率下移到副标题。
- **[20:19:29]** 坑：Windows PowerShell 5.1 读无 BOM 的 UTF-8 脚本会把中文当 ANSI，导致 deploy.ps1 解析失败；给 ps1 补 EF BB BF 后正常。补 BOM 必须字节级追加，不能用 ReadAllText/WriteAllText 往返（会把行首 # 弄丢）。
- **[20:51:27]** 实时更新方案：Valve 接口无 CORS（ACAO 缺失），公共代理 allorigins/codetabs 返回 522、corsproxy 需 key -> 浏览器直连方案不可行。改为本地 Windows 计划任务 SteamLighthouse-Update 每天 11:00 跑 scripts/update-online.ps1（抓新游 -> 重建 -> 推送）。
- **[20:51:27]** GitHub Actions 方案受阻：gh 的 OAuth token 只有 gist/read:org/repo，没有 workflow scope，推送含 .github/workflows 的提交会被服务端拒绝（API 也 404）。工作流已备好放在 站点仓库 tools/update-workflow.yml.txt，用户执行 gh auth refresh -s workflow 后即可启用云端每日更新（关机也能更新）。
- **[21:32:22]** 悬停没生效的根因是浏览器缓存：静态资源被缓存 1 小时，用户页面还在跑加浮层之前的 JS。修法：build-static 给 app.js/style.css/local-api.js 加 ?v=<版本指纹>，Node 服务改 no-cache，并去掉卡片的原生 title 属性（那正是截图里黑框小提示）。
- **[21:32:23]** 多选标签改为 AND 语义：/api/random?tags=1,2,3 与 /api/similar 同步改造；前端自绘下拉（带计数与标签搜索）+ 已选 chips。
- **[21:32:23]** 语料 9816 -> 10285(云 469) -> 11521(云 1236)；云端工作流参数调大到 --limit=4000 --tags=40 --pages=3，单次 136 秒。
- **[21:46:52]** 新增更新日志：sync.mjs 每次写 data/changelog.json（最多200条）+ 重写 CHANGELOG.md；工作流提交时带上这两个文件；网站页脚「更新日志」用表格展示。
- **[21:46:52]** 新增游戏资料面板：卡片右上角 ⓘ 打开 SteamDB 风格面板（标签条/横幅/好评率/评测数/发售/价格/简介/开发商发行商/系统需求/Steam+YouTube+加种子），深链 ?info=<appid>。

## 4. 关键上下文（路径 / 命令 / 参数 / 代码位置）

| 项目 | 值 | 说明 |
| --- | --- | --- |
|  |  |  |
- **[18:53:15]** 源码 D:\\综合创作\\steam-lighthouse ；部署目录 D:\\综合创作\\SteamSearchAny-web
- **[18:53:15]** 私有仓库 https://github.com/OStonefishO/SteamSearchAny ；公开站点仓库 https://github.com/OStonefishO/SteamSearchAny-web
- **[18:53:16]** 线上永久地址 https://ostonefisho.github.io/SteamSearchAny-web/
- **[18:53:16]** 客户端 client/out/SteamSearchAny.exe（源码 client/Launcher.cs，图标 client/app.ico，载荷 client/site.zip 不入库）
- **[18:53:16]** 语料 data/corpus.json + data/build-state.json；快照 data/steam-db.json（29MB，已 gitignore，重建时用 curl 拉 Nebukam/steam-db）
- **[18:53:17]** 脚本：scripts/build-static.mjs（生成 dist）、serve-static.mjs（本地预览 dist，带 query 处理）、make-share-card.py（网址卡片）、clean-years.mjs、enrich-extra.mjs、check-*.mjs
- **[18:53:17]** 端口：5173 本地 Node 服务 / 5174 静态预览 / 8765 客户端（占用时 +1 递增）
- **[20:19:29]** 字体：public/fonts/inter-{400,500,600,700}.woff2（各约 24KB，来自 @fontsource/inter@5.0.20）
- **[20:51:28]** 计划任务：schtasks /TN SteamLighthouse-Update /SC DAILY /ST 11:00；脚本 scripts/update-online.ps1（带 BOM，日志 data/update.log）；增量抓取 scripts/sync-new-games.mjs（榜单 + 标签最新页，连续 4 次失败自动跳过商店源）。
- **[20:51:28]** 站点仓库 tools/sync.mjs 是同一套逻辑的 games.json 版本（给云端用）；tools/update-workflow.yml.txt 是待启用的 Actions 工作流。
- **[21:32:23]** 回填脚本 scripts/backfill-detail.mjs 走 GetItems(basic_info) 补 desc(220字) 与英文名 en；build-static 输出第 11 列 desc，前端 local-api 读 row[10]。
- **[21:46:52]** 回填：scripts/backfill-devs.mjs 补开发商(11489)与发行商(11133)；build-static 第12列 extra=[dev,pub,req]。

## 5. 已完成

-
- **[18:53:17]** 已交付：双模式站点（盲盒 + 相似追踪）、9814 款语料、私有仓库、静态线上站、桌面 exe、头像+make with love 署名、.gitattributes 换行规范、记忆文件。
- **[20:19:29]** UI v2 已上线 https://ostonefisho.github.io/SteamSearchAny-web/ ，客户端 exe 同步重打包（1.06MB）。
- **[20:51:29]** 完成：卡片悬停浮层（封面/年份/价格/好评/标签/相似度或冷门指数）、语料版本指纹 version.json（避免浏览器缓存旧语料）、每日自动更新任务、客户端重打包。
- **[21:46:53]** 语料 11627 款；线上 pages 24/7；exe 2.63MB 同步重打包。

## 6. 待办与未决问题

| # | 事项 | 阻塞点 | 下一步 |
| --- | --- | --- | --- |
| 1 |  |  |  |
- **[18:53:18]** 可选改进：相似结果加按冷门指数重排开关；详情弹窗加 Steam 商店截图；静态版搜索只覆盖 9814 款（无 13 万条名称索引）。
- **[18:53:18]** 可选：若想彻底不依赖公开仓库，可换 Cloudflare Pages / Netlify（支持私有仓库），或用自有域名 CNAME 到 GitHub Pages。
- **[18:53:19]** 维护：语料更新后需重跑 build-static.mjs 并把 dist 覆盖到 D:\\综合创作\\SteamSearchAny-web 再 push，否则线上不更新。
- **[20:51:29]** 待用户操作（可选）：gh auth refresh -s workflow -> 我就能把 Actions 工作流推上去，实现关机后也自动更新。
- **[21:32:24]** 待观察：Valve 的 review_count 是过滤后的数量，个别知名作品显示评测数偏低，冷门指数因此偏高，可考虑换 summary_language_specific 或标记疑似值。
- **[21:46:53]** 待办：系统需求 req 仍为空占位，需要云端定时调 store appdetails 逐款抓（每款1次请求），建议每次跑 300-400 款渐进补齐。

## 7. 下次接续要点（≤10 条，最重要的写最前）

1.
- **[18:53:19]** 线上地址 https://ostonefisho.github.io/SteamSearchAny-web/ （永久，关机可用）。
- **[18:53:19]** 源码在 D:\\综合创作\\steam-lighthouse，私有仓库 OStonefishO/SteamSearchAny；产物仓库 OStonefishO/SteamSearchAny-web。
- **[18:53:20]** 本地开发：node server/index.mjs（5173）；改完前端要重跑 node scripts/build-static.mjs 才更新 dist。
- **[18:53:20]** 改 .exe：先 Compress-Archive dist 成 client/site.zip，再用 csc 编译 client/Launcher.cs（/resource:site.zip,site.zip）。
- **[18:53:20]** GitHub 与 Valve 域名都会间歇断流，git push 必须重试循环（已用过 8-40 次不等的重试）。
- **[20:19:30]** 当前视觉基线：9 列密网格 / Inter + 系统中文黑体 / 主卡 hero 带右下统计块；改 UI 后记得 node scripts/build-static.mjs 再 deploy。

## 8. 原始请求摘录

> 
- **[18:53:21]** 用户原话摘录：帮我做一个关于steam的网站…有随机刷新游戏的页面…也可以通过输入对应的游戏来查找与之相似的游戏（比如我输入 No Man's Sky就查找类似它的游戏，参考steampeek，然后可以多输入几个游戏，然后相似度就会越往这几个游戏上面靠）。后续追加：在我github新建一个仓库，闭源，叫SteamSearchAny，加上我的头像和make with love；做完之后给我个网址，这个网址我希望是永久的，在我关闭电脑后也可以继续使用，如果可以的话你做一个客户端.exe，网址发我手机上，并且把前面的对话记录下来到你的MD里。
