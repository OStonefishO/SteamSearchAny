# 踩坑记录（每次执行任务前先读一遍）

> 规则：**动手前先读本文件**。每踩一个新坑，追加一条，格式固定：
> `现象 → 根因 → 正确做法 → 自检动作`。
> 只记"会导致返工/误导用户"的坑，不记正常的 bug 修复细节。

---

## 一、PowerShell 与文件编码（最高频，害我最多）

### 1. PowerShell 5.1 把无 BOM 的 UTF-8 当 ANSI 读
- **现象**：脚本跑完中文全变乱码（`小时前` → `灏忔椂鍓`），JS 语法直接崩。
- **根因**：PS 5.1 的 `Get-Content`/`Set-Content` 默认按系统 ANSI 解码；`Get-Content -Raw | Set-Content -Encoding utf8` 会二次转码，把原本正确的 UTF-8 写坏。
- **正确做法**：
  - 改前端源码**一律用 `edit` / `write` 工具**，不用 PowerShell 重写文件。
  - 万不得已用 PowerShell 时：`[IO.File]::ReadAllText($abs, [Text.UTF8Encoding]::new($false))` + `[IO.File]::WriteAllText($abs, $text, [Text.UTF8Encoding]::new($false))`。
- **自检**：改完立刻 `node --check <file>`，并 grep 一次中文关键字是否还在。

### 2. 相对路径解析到进程 CWD，不是脚本目录
- **现象**：`[IO.File]::ReadAllText("public/index.html")` 报找不到文件。
- **正确做法**：**永远用绝对路径**。

### 3. PS 5.1 不支持 `??`、管道里 `&&`
- **现象**：`ParserError: 表达式或语句中包含意外的标记“??”`。
- **正确做法**：用 `if ($x) { ... } else { ... }`；`gh api ... --jq '.a + " " + (.b // "ok")'` 里的 `//` 属于 jq，不是 PS。

### 4. `node -e "..."` 里的引号/`${}`/`||` 会被 PowerShell 解析
- **现象**：`Expression expected`、`SyntaxError: Unexpected end of input`，或 `||` 被当成管道。
- **正确做法**：把补丁写成 `.mjs` 文件（用 `write` 工具创建）再 `node xxx.mjs` 执行；不要在 `node -e` 里塞复杂字符串。

---

## 二、缓存（害用户反复说"没生效"）

### 5. 用固定版本号做缓存击穿 = 永久缓存
- **现象**：连续三次改了 `community.js`，用户刷新都说"没有变化"。
- **根因**：`import('./community.js?v=' + (window.__LH_BUILD || '1'))`，`__LH_BUILD` 从未赋值 → URL 恒为 `?v=1` → 浏览器永久用旧文件。
- **正确做法**：
  - 用**构建时生成的哈希/时间戳**做版本号；
  - 或开发期直接 `Date.now()`；
  - 子模块 import 也要带版本（`./supabase-lite.js?v=N`），否则父模块更新了、子模块还是旧的，报 `doesn't provide an export named`。
- **自检**：`curl` 线上文件，grep 新增的函数名/关键字是否真的在里面。

### 6. 资源指纹只算数据，不算代码
- **现象**：改了 `app.js`，但 HTML 里还是 `app.js?v=2026-11-26-...-2j1j`，URL 没变 → 用户拿旧代码。
- **正确做法**：指纹 = **所有前端文件内容哈希 + 构建时间**，任一文件变化都要变。
- **自检**：改动前后对比 HTML 里的 `?v=` 是否变化。

### 7. 判断"是否已生效"不能靠肉眼看仓库
- **正确做法**：每轮部署后 `curl` 线上文件，grep 关键字 + 比对 `Content-Length` + `node --check`。

---

## 三、部署与仓库

### 8. 没跑语法检查就推送
- **现象**：把编码损坏的 `community.js` 推上线，全站社区报错。
- **正确做法**：**推送前必须** `node --check` 全部改动的 JS；失败就停止，绝不 commit。
- **自检**：部署脚本里加 `if ($LASTEXITCODE -ne 0) { exit 1 }`。

### 9. 大文件被截断却以为坏了
- **现象**：`games.json` 报 `Unexpected end of JSON input`，实际是**我下载被网络截断**（1.59MB / 6.37MB）。
- **正确做法**：用 `curl -I` 看 `Content-Length` 对比仓库 `git` size 与本地文件大小，三方一致才算完整。

### 10. 拷贝 + merge 冲突把数据文件写坏
- **现象**：`data/games.json` 变成 6.02MB 的截断文件，全站随机/详情接口全挂（`LOCAL_ENGINE_FAILED`）。
- **正确做法**：部署顺序固定为 `git pull --rebase` → 构建 → 拷贝 → 提交 → 推送；数据文件冲突用 `git checkout --theirs data/*.json`；拷贝后立刻 `JSON.parse` 校验。

### 11. GitHub Pages 项目页不能用根绝对路径
- **现象**：`<script src="/config.js">` → 404（解析到 `用户名.github.io/config.js`），配置没加载，登录按钮显示"未配置"。
- **正确做法**：项目页一律**相对路径** `config.js`。

### 12. "推送成功"不代表线上生效
- **正确做法**：等 40–60 秒（Pages 构建）后再 `curl` 验证；Pages 偶发 404 时先怀疑网络/CDN，再用 `?q=随机` 重试。

---

## 四、Supabase / 后端

### 13. RLS 策略缺失导致"静默失败"
- **现象**：删帖没按钮、补 UID 不生效、发帖失败，但前端只显示通用错误。
- **根因**：`posts` 表缺 `update`/`delete` 策略，或 `author_email` 为空对不上 `auth.jwt()->>'email'`。
- **正确做法**：每加一个写操作，同步补齐 insert/update/delete 三条策略，并把 `auth.jwt() ->> 'email'` 作为归属判据。
- **自检**：`select policyname, cmd from pg_policies where tablename='posts';`

### 14. 建表后 PostgREST 有 schema 缓存
- **现象**：SQL 执行成功，但 API 仍报 `Could not find the table`。
- **正确做法**：等 1 分钟，或执行 `notify pgrst, 'reload schema';`

### 15. 免费版不能改邮件模板
- **现象**：想在验证码邮件里加 `{{ .Token }}`，编辑器只读。
- **根因**：Supabase 免费版要求配置 **自定义 SMTP** 才能编辑模板。
- **正确做法**：要么配 SMTP（Gmail 500 封/天、Brevo 300/天、SES 6.2 万/月），要么走"邮件链接 + 密码登录 + 配对码中转"的组合。

### 16. JWT 1 小时过期会裸报 `JWT expired`
- **正确做法**：`rest()` 里统一拦截 401 → 用 `refresh_token` 换新 token 并重试一次 → 仍失败才提示"重新登录"，并把本地会话清掉。

### 17. 邮箱魔法链接"只在手机上登录"
- **根因**：链接里的 token 属于打开它的那台设备；电脑发起、手机点开 → 只有手机登录。
- **正确做法**：并发三条路 —— ① 密码登录；② 配对码中转（6 位码 + 32 位 secret + AES-GCM）；③ 复制登录链接到电脑。

---

## 五、前端架构

### 18. 把"数据就绪"和"界面可用"绑死
- **现象**：语料 6MB 没下完时，登录按钮点了没反应，全站像挂了。
- **正确做法**：HTML 内联一段独立脚本绑定关键按钮（登录），不依赖主程序初始化；数据加载只影响内容区，并在顶部显示进度。

### 19. `display:grid/flex` 覆盖 `[hidden]`
- **现象**：弹窗遮罩永远盖着页面，点哪儿都没反应（小程序 `.sheet` 那次）。
- **正确做法**：全局加 `[hidden], .hidden { display: none !important; }`

### 20. 入口藏太深 = 用户找不到
- **现象**：删帖按钮放进了详情页，用户一直说"不能删帖"。
- **正确做法**：凡是"用户明确要求过"的操作，主视图就要有入口或明显提示；改了位置要主动说明。

---

## 六、沟通与交付纪律

### 21. 不许用"应该好了"代替验证
- 每次报告"完成"前，必须给出：`node --check` 结果、线上 `curl` grep 结果、或截图。

### 22. 前端片段别扔给用户在 SQL Editor 里跑
- **现象**：用户把 JS 代码粘进 Supabase SQL Editor，报 `syntax error at or near "const"`。
- **正确做法**：给用户的永远是**可执行的 SQL**；讲解代码时明确标注"这是说明，不用执行"。

### 23. 一个人踩过的坑要写下来
- 就是本文件。每次新坑 → 追加 → 提交。
