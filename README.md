# 国际局势简报 Agent

> 面向时效性议题的多源联网研究与日报系统。系统定时检索公开网页、读取候选原文、归并同一事件，并生成带可追溯来源的中文简报与上下文追问体验。

## 核心能力

- **联网研究流水线**：通过 LangChain 工具执行网页搜索与原文读取，支持博查（Bocha）和 Tavily 搜索提供商。
- **多源事件归并**：对标题相近的候选网页聚类；仅保留至少由两个独立域名报道、且原文可读取的事件。
- **证据约束生成**：LLM 只能综合本轮实际读取的网页；来源链接由服务端重新绑定和校验，而非直接相信模型输出。
- **持久化日报**：将日报、事件、来源、引用与 Agent 运行记录写入 PostgreSQL，可查询当天已发布版本。
- **定时运行**：Vercel Cron 按北京时间每天零点触发自动研究任务；当天已有已发布日报时安全跳过。
- **上下文追问**：详情页使用独立的 OpenAI 兼容 LLM 配置，结合当前事件材料和最近对话回答背景、概念与潜在影响。
- **安全的推测边界**：当前事件的时效事实以收集到的材料为依据；材料缺失时，模型可提供明确标注的条件性分析，但不得将推测包装为已核实事实。

## 架构

```mermaid
flowchart LR
  cron[Vercel Cron] --> route[/api/cron/digest]
  route --> agent[Web Research Agent]
  agent --> search[Search Provider\nBocha / Tavily]
  agent --> fetch[Fetch & Clean Articles]
  search --> cluster[Event Clustering]
  fetch --> cluster
  cluster --> gate{>= 2 独立域名?}
  gate -->|通过| llm[DeepSeek Synthesis]
  gate -->|未通过| discard[Discard]
  llm --> validate[Citation Validation]
  validate --> db[(Neon PostgreSQL)]
  db --> web[Next.js Dashboard]
  web --> chat[Contextual AI Q&A]
```

## 技术栈

| 层级 | 技术 |
| --- | --- |
| Web 应用 | Next.js 16、React 19、TypeScript、CSS Modules |
| Agent 与模型 | LangChain、`@langchain/openai`、DeepSeek、OpenAI 兼容 Chat Completions |
| 检索与网页处理 | 博查 / Tavily、服务端网页抓取、URL 规范化、来源准入策略 |
| 数据层 | Prisma 7、PostgreSQL、Neon、`pg` Adapter |
| 调度与部署 | Vercel Cron、Vercel Serverless、pnpm 脚本 |
| 质量保障 | Vitest、ESLint、Zod、Prisma Schema / Migrations |

## 研究流程

1. Cron 以 `Asia/Shanghai` 解析业务日期，查询当天是否已有已发布日报。
2. Agent 并行检索外交、安全、贸易、能源与区域局势等主题。
3. 搜索结果经过 URL 规范化、域名策略、发布时间和语言规则过滤。
4. 服务端读取候选网页正文，并将相似标题归并为事件簇。
5. 事件必须同时满足“至少两个独立域名”和“至少两个可读取原文”才会进入生成阶段。
6. DeepSeek 基于事件簇的实际材料输出结构化日报；服务端再次验证引用链接并写入数据库。
7. 首页读取当天已发布日报；详情页展示摘要、来源以及带事件上下文的 AI 追问。

## 快速开始

### 前置要求

- Node.js 22+
- pnpm 11+
- PostgreSQL 数据库（推荐 Neon）
- 一个搜索 API 密钥（博查或 Tavily）
- DeepSeek API 密钥

### 安装

```powershell
git clone https://github.com/xcymm3/News.git
cd News
pnpm install
Copy-Item .env.example .env
```

编辑 `.env` 后，初始化数据库并启动开发服务：

```powershell
pnpm db:deploy
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000)。

### 最小配置

```dotenv
NEXT_PUBLIC_APP_URL="http://localhost:3000"

DATABASE_URL="postgresql://..."

DEEPSEEK_API_KEY="..."
DEEPSEEK_MODEL="deepseek-chat"

WEB_SEARCH_PROVIDER="bocha"
WEB_SEARCH_API_KEY="..."
WEB_SEARCH_ROLLOUT="full"

# 详情页 AI 追问，可使用任意 OpenAI 兼容服务
LLM_API_KEY="..."
LLM_BASE_URL="https://.../v1"
LLM_MODEL="..."
```

生产环境还需要设置高强度的 `CRON_SECRET`。所有非 `NEXT_PUBLIC_` 环境变量仅在服务端读取；不要提交真实密钥。

## 配置说明

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | Neon / PostgreSQL pooled connection string |
| `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL` | 日报综合模型，仅用于联网研究任务 |
| `WEB_SEARCH_PROVIDER` | 当前支持 `bocha` 或 `tavily` |
| `WEB_SEARCH_API_KEY` | 搜索服务密钥 |
| `WEB_SEARCH_ALLOWED_DOMAINS` | 可选，逗号分隔的来源域名后缀白名单 |
| `WEB_SEARCH_EXCLUDED_DOMAINS` | 可选，逗号分隔的来源域名后缀黑名单 |
| `WEB_SEARCH_MAX_RESULTS` | 单个搜索查询的最大候选数，默认 12 |
| `WEB_SEARCH_MAX_AGE_HOURS` | 允许的候选网页最大时效，默认 72 小时 |
| `WEB_SEARCH_ROLLOUT` | `full` 启用定时生成；`disabled` 跳过任务 |
| `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` | 详情页 AI 追问的独立模型配置 |
| `LLM_PROXY_URL` | 可选的服务端 HTTP(S) 代理 |
| `CRON_SECRET` | 保护 `/api/cron/digest` 的 Bearer Token |

完整示例见 [`.env.example`](./.env.example)。

## 定时任务与部署

[`vercel.json`](./vercel.json) 中的 Cron 表达式为：

```json
{ "path": "/api/cron/digest", "schedule": "0 16 * * *" }
```

Vercel 以 UTC 解释该表达式，UTC `16:00` 即北京时间次日 `00:00`。任务路由会自行按 `Asia/Shanghai` 判断日报日期。Vercel Hobby 计划可能在预定时间后存在弹性执行窗口。

部署到 Vercel 时，请在 **Production** 环境中设置：

```text
DATABASE_URL
DEEPSEEK_API_KEY
DEEPSEEK_MODEL
WEB_SEARCH_PROVIDER
WEB_SEARCH_API_KEY
WEB_SEARCH_ROLLOUT=full
CRON_SECRET
LLM_API_KEY
LLM_BASE_URL
LLM_MODEL
NEXT_PUBLIC_APP_URL
```

`/api/agent/digest` 已明确关闭，不会执行公开的手动研究请求；日报仅由受 `CRON_SECRET` 保护的定时任务生成。

## API

| 路径 | 用途 |
| --- | --- |
| `GET /api/digest/today` | 返回当天已发布日报 |
| `GET /api/digest/today/:storyId` | 返回当天指定事件 |
| `POST /api/story-questions` | 对当前事件发起上下文追问 |
| `GET /api/news-source/latest` | 读取原始 RSS 输入，供诊断使用 |
| `GET /api/news-source/processed` | 返回去重、清洗后的 RSS 候选，供诊断使用 |
| `GET /api/cron/digest` | 受 Bearer Token 保护的定时任务入口 |

## 质量与验证

```powershell
pnpm test                 # 单元测试
pnpm test:web-search-eval # 检索与日报规则评测
pnpm lint                 # ESLint
pnpm build                # Prisma Client 生成与 Next.js 生产构建
```

当前测试覆盖来源规范化、搜索 Provider、事件聚类、日报持久化、运行策略、聊天服务和 Agent 输出评测等核心路径。

## 项目结构

```text
src/
  app/                         Next.js 页面与 Route Handlers
  features/
    agent/                     联网研究与日报生成 Agent
    chat/                      事件上下文追问与流式响应
    digest/                    日报读取、校验与 Prisma 持久化
    news-source/               RSS 输入与文章预处理
    web-search/                Provider、网页读取、聚类与来源策略
  lib/                         Prisma Client、站点 URL 等基础设施
prisma/
  schema.prisma                数据模型
  migrations/                  数据库迁移
```

## 设计边界

- 这是一个面向**时效性信息**的联网研究系统，不使用向量数据库作为主检索路径；重点是当轮网页读取、多来源归并和引用校验。
- AI 生成内容用于信息整理与辅助理解，不构成投资、法律或其他专业建议。
- 网页可访问性、搜索 API 配额与模型服务可用性会影响单次任务结果；失败会写入 Agent 运行记录，已有已发布日报不会被失败结果覆盖。
- 项目当前聚焦中文国际议题，但检索 Provider、来源策略和 Agent 输入层已保持可替换边界。
