# 国际局势简报

一个面向 Web Beta 的国际局势一页新闻简报：用户打开首页即可阅读当天重点事件，并可围绕单一事件持续追问、查看引用来源。

## 本地开发

### 前置要求

- Node.js 22 或更高版本
- pnpm 11 或更高版本
- Git

### 启动步骤

在 PowerShell 中运行：

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。`.env.local` 必须放在项目根目录，不能放在 `src` 目录中。

### 常用命令

```powershell
pnpm dev
pnpm test
pnpm lint
pnpm build
pnpm start
```

### 数据库命令

先在 `.env.local` 中填写可用的 `DATABASE_URL`，再运行：

```powershell
pnpm db:validate
pnpm db:generate
pnpm db:migrate
```

`pnpm db:generate` 会将客户端生成到 `src/generated/prisma`。该目录不纳入版本控制；每次修改 `prisma/schema.prisma` 后都必须重新生成。

生产环境只运行已提交的迁移：

```powershell
pnpm db:deploy
```

## 环境变量

`.env.example` 是可提交的配置模板；`.env.local` 保存本机密钥，已被 Git 忽略。不要将任何真实密钥写入代码、README 或提交记录。

| 变量 | 用途 | 是否暴露给浏览器 |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_NAME` | 页面显示的产品名称 | 是 |
| `NEXT_PUBLIC_APP_URL` | 本地或生产站点地址 | 是 |
| `DATABASE_URL` | PostgreSQL 连接地址 | 否 |
| `REDIS_URL` | 缓存和任务队列连接地址 | 否 |
| `DEEPSEEK_API_KEY` | DeepSeek RAG Agent 的密钥（优先使用） | 否 |
| `DEEPSEEK_MODEL` | DeepSeek 模型，默认 `deepseek-v4-flash` | 否 |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | 兼容的模型配置项 | 否 |
| `NEWS_SOURCE_API_KEY` | 需要密钥的新闻来源预留配置 | 否 |
| `NEWS_SOURCE_PROVIDER` | 原始新闻来源（默认 `multi-rss-zh`，可选 `un-news-rss`、`gdelt-doc`） | 否 |
| `WEB_SEARCH_PROVIDER` | 全网搜索供应商标识（`tavily`、`brave`、`serper` 或 `custom`） | 否 |
| `WEB_SEARCH_API_KEY` | 全网搜索 API 密钥 | 否 |
| `WEB_SEARCH_BASE_URL` | 自定义搜索供应商的 HTTPS 地址 | 否 |
| `WEB_SEARCH_ALLOWED_DOMAINS` / `WEB_SEARCH_EXCLUDED_DOMAINS` | 逗号分隔的来源域名后缀准入/排除规则 | 否 |
| `SESSION_SECRET` | 匿名会话签名密钥 | 否 |
| `SENTRY_DSN` | 错误监控配置 | 否 |

只有以 `NEXT_PUBLIC_` 开头的变量才会被 Next.js 编译进浏览器代码。其他变量只能在服务端读取。

### Neon PostgreSQL

在 Neon 创建项目后，将控制台提供的 **pooled connection string** 填入本地 `.env` 与 Vercel 的 `DATABASE_URL`。连接串必须保留 `sslmode=require`。首次连接后运行：

```powershell
pnpm db:deploy
```

该命令会创建日报、新闻来源、引用和 Agent 运行记录所需的表。不要提交 `.env` 或连接串。

### 自动日报

生产环境由 Vercel Cron 每天 UTC `00:10`（北京时间 `08:10`）调用 `/api/cron/digest`。在 Vercel 的 Production 环境中设置 `CRON_SECRET`，并同时设置 `DATABASE_URL` 和 AI 服务环境变量；接口只接受 `Authorization: Bearer <CRON_SECRET>` 的请求。当天已有已发布日报时，定时任务会安全跳过，首页继续读取数据库中的已发布版本。手动“运行 Agent”按钮仍会保留，并会发布一个新的日报版本用于测试。

## 实时新闻输入

默认实时输入是 7 个中文 RSS：中新网滚动与国内、新华网国际、央视网国内、36 氪综合与快讯、中央社国际。服务端会并行读取它们；单个源暂时失败不会中断聚合，只有所有源均无可用条目时才会失败。也可将 `NEWS_SOURCE_PROVIDER` 设为 `un-news-rss` 使用单一 UN News，或设为 `gdelt-doc` 使用 GDELT DOC：

```text
GET /api/news-source/latest
GET /api/news-source/processed
```

`/latest` 只返回原始文章标题、摘要、原文链接、来源域名、语言和抓取时间；`meta.sourceNames` 列出本次成功读取的 RSS 来源，`processingState` 为 `raw`。`/processed` 会删除追踪参数、按 URL 与标准化标题去重、排除异常或超过 `NEWS_SOURCE_MAX_AGE_HOURS` 的旧条目，并把标题中至少共享两个有效词项的文章聚为事件候选；中文标题会按连续双字片段进行相似度比对。`processingState` 为 `candidate`。两者都不会直接替换首页日报，也不会把外部标题标为已核验内容。服务端对同一请求结果缓存 5 分钟，以避免触发来源限流。

## DeepSeek RAG Agent（测试）

在 `.env.local` 填入 `DEEPSEEK_API_KEY` 后，首页会出现“运行 Agent”按钮。按钮触发后，DeepSeek Agent 会通过 `search_current_news` 工具读取当前 RSS 聚合结果；工具返回的标题、摘要、原文链接和文章 ID 再交给 DeepSeek 做整合、评分与中文摘要。模型只能返回这些文章 ID 作为引用；服务端会重新绑定原文并执行日报引用校验，未通过时不会替换现有日报。

为避免误触发额度，Agent 不会在页面加载时自动运行；同一服务进程会复用 30 分钟内的成功结果。当前 RAG 检索范围是配置的 RSS 新闻源，不是无边界全网搜索。

## 全网搜索 Agent（第一阶段）

已定义全网搜索的统一输入、结果和来源准入契约，位于 `src/features/web-search/web-search-contract.ts`。候选网页会统一为标题、摘要、规范 URL、来源域名、发布时间和 `zh-CN` 语言标记；追踪参数会被移除，非 HTTP(S)、本地地址、排除域名或不在允许域名列表内的结果会被拒绝。

第二阶段已安装 LangChain，并提供 `search_web` 与 `fetch_article` 两个服务端工具；Agent 每次运行最多调用 6 次工具。`search_web` 的首个实际适配器为 Tavily：设置 `WEB_SEARCH_PROVIDER="tavily"` 和 `WEB_SEARCH_API_KEY` 后才会请求其 API。`fetch_article` 只读取来源规则允许的 HTTP(S) 网页，移除脚本与样式内容，并限制返回正文长度。API 未配置时会返回明确的“尚未配置全网搜索 API”错误；当前 RSS 正式链路仍未替换。

## 当前目录

```text
src/
  app/                 Next.js 页面与路由入口
  components/          可复用界面组件
  features/digest/     每日简报功能
  features/chat/       单事件问答功能
  jobs/                后台任务定义
  lib/                 通用工具与客户端
  server/              服务端业务逻辑
  types/               共享 TypeScript 类型
prisma/                数据库 Schema 和迁移
```

当实时来源可用且日报校验通过时，首页会展示自动整理候选；来源不可用或校验失败时会安全回退为演示日报。真实新闻输入、去重聚类、日报生成、引用校验、事件问答与匿名记录已具备基础实现。
