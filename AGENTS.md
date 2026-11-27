# AGENTS

## 执行纪律（最重要）

1. **每次开始任务前，先完整读一遍 `mistake.md`**，里面记录了所有会导致返工的坑（编码、缓存、RLS、部署顺序等）。
2. 改动任何文件后立刻运行 `node --check`，失败即停止，不提交。
3. 每次报告"完成"必须附验证证据：语法检查结果 / 线上 `curl` grep / 截图，禁止只用"应该好了"。
4. 给用户执行的永远是**可运行的 SQL**；JS 片段必须标注"这是说明，不用执行"。
5. 部署顺序固定：`git pull --rebase` → 构建 → 拷贝 → 提交 → 推送 → 等待 40s → `curl` 验证。

## 项目速览

- 站点：`https://ostonefisho.github.io/SteamSearchAny-web/`
- 源码仓库：`OStonefishO/SteamSearchAny`（本目录）
- 产物仓库：`D:\综合创作\SteamSearchAny-web`（GitHub Pages，只放 dist 内容）
- 构建：`node scripts/build-static.mjs` → `dist/`
- 后端：Supabase（`public/config.js` 里配置 url + publishable key）
- 数据库脚本：`db/schema.sql`、`mistake.md` 里各条 SQL

## 修改文件的正确姿势

| 场景 | 用什么 |
|---|---|
| 改前端源码（.js/.html/.css） | `edit` / `write` 工具，**不要用 PowerShell 重写** |
| 批量替换 | 写一个 `.mjs` 补丁脚本，`node` 执行 |
| 改完必做 | `node --check <file>` |
| 部署后必做 | `curl` 线上文件 grep 关键字 |
