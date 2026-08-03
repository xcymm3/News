# Agent 可观测性与评估数据契约

## 目标

首页的“生成详情”弹窗用于解释一份日报如何产生，而不是提供模型或数据库管理能力。它应让读者看见本次运行的输入、阶段漏斗、质量评估与失败信息，同时绝不暴露 API 密钥、请求鉴权信息或原始模型提示词。

本文定义后续实现阶段共享的数据边界。字段名、指标算法和展示文案均以本文为准；指标算法发生不兼容变化时，必须提升 `evaluationVersion`。

## 当前可用数据

`AgentRun` 已保存每次成功或失败的日报任务，当前字段如下：

| 数据 | 现状 | 用途 |
| --- | --- | --- |
| `digestDate`、`trigger`、`status` | 已持久化 | 标识日报日期、手动/定时来源与最终状态 |
| `model` | 成功任务持久化 | 展示实际使用的摘要模型名称 |
| `retrievedDocumentCount` | 成功任务持久化 | 展示最终进入摘要流程的网页数量 |
| `publishedStoryCount`、`digestId` | 成功任务持久化 | 关联已发布日报并展示产出条数 |
| `startedAt`、`completedAt` | 已持久化 | 计算端到端耗时 |
| `errorMessage` | 失败任务持久化 | 展示已脱敏的失败摘要 |

当前全网研究 Agent 的实际流水线为：博查/Tavily 主题检索 → URL 去重与标题聚类 → 独立域名门槛 → 原文读取 → DeepSeek 综合 → 引用校验与发布。现有 `AgentRun` 无法说明各阶段的候选数、耗时或被丢弃原因，因此不能仅依赖已有字段完成控制台。

## 新增运行轨迹契约

每个 `AgentRun` 可拥有零到多条有序的阶段记录。阶段记录只保存聚合数值和可公开的错误摘要，不保存完整网页正文、模型思维链或密钥。

### 阶段枚举

| 阶段 | 说明 | `inputCount` | `outputCount` |
| --- | --- | --- | --- |
| `SEARCH` | 并行执行主题检索并汇总候选网页 | 主题查询数 | 返回候选网页数 |
| `CLUSTER` | URL 去重、标题聚类、独立域名筛选 | 候选网页数 | 合格事件簇数 |
| `FETCH` | 读取每个事件的代表性来源正文 | 计划读取网页数 | 成功读取网页数 |
| `SYNTHESIZE` | 将同一事件的多源材料交给模型综合 | 合格事件簇数 | 可解析摘要数 |
| `VALIDATE` | 校验摘要、引用 URL 与事件唯一性 | 模型摘要数 | 可发布事件数 |
| `PUBLISH` | 持久化日报、事件、来源及本次运行 | 可发布事件数 | 已发布日报条目数 |

所有阶段均按开始顺序记录。未执行的阶段不写入记录；执行失败的阶段记录 `FAILED` 状态和受限长度的 `errorMessage`。一次运行的最终状态仍由 `AgentRun.status` 表示。

### 阶段记录字段

后续 Prisma 模型需具备以下语义：

| 字段 | 说明 |
| --- | --- |
| `agentRunId` | 所属运行的外键 |
| `stage`、`position` | 阶段枚举和稳定排序序号 |
| `status` | `RUNNING`、`SUCCEEDED`、`FAILED`、`SKIPPED` |
| `inputCount`、`outputCount` | 允许为空的聚合数量，不以 `0` 混淆“未统计” |
| `durationMs` | 单阶段端到端耗时，包含该阶段必要的网络等待 |
| `details` | 可选 JSON，仅保存来源提供方、跳过主题数、丢弃原因计数等安全元数据 |
| `errorMessage` | 脱敏且截断后的失败摘要 |
| `startedAt`、`completedAt` | 支持时间线、重试分析和异常诊断 |

## 质量评估契约

质量评估针对“已成功发布”的日报生成；失败运行只展示阶段失败信息，不伪造质量分数。评估由确定性代码计算，不让模型给自己打分。

| 指标 | 计算方式 | 范围 |
| --- | --- | --- |
| `freshnessScore` | 每条事件取最新引用发布时间；在 48 小时内计满分，之后线性衰减至 0；全日报取平均 | 0–100 |
| `multiSourceCoverage` | 至少有两个不同域名来源的已发布事件占比 | 0–100 |
| `averageSourcesPerStory` | 已发布事件的独立域名来源数平均值 | ≥ 0 |
| `sourceDomainCount` | 本次日报引用的独立域名数量 | ≥ 0 |
| `categoryCoverage` | 基于现有标题分类规则得到的非空类别数 / 支持类别数 | 0–100 |
| `duplicateFreeRate` | 经确定性标题相似度检查后，未与其他已发布事件重复的事件占比 | 0–100 |
| `citationUrlValidity` | 可解析且为 HTTP(S) 的引用 URL 占比；它不代表事实真伪 | 0–100 |
| `totalDurationMs` | 从 `AgentRun.startedAt` 到 `completedAt` 的耗时 | ≥ 0 |

评估结果必须保存 `evaluationVersion`。初版为 `v1`，并在界面明确说明：这些指标衡量流程健康度与来源结构，不等同于新闻事实的独立核验。

## 控制台读取模型

控制台只读接口需要返回以下数据，不返回环境变量、API Key、完整提示词、原始网页正文或用户会话内容：

```ts
type AgentObservabilitySnapshot = {
  latestRun: {
    id: string;
    digestDate: string;
    trigger: "manual" | "cron";
    status: "running" | "succeeded" | "failed";
    model?: string;
    startedAt: string;
    completedAt?: string;
    totalDurationMs?: number;
    retrievedDocumentCount?: number;
    publishedStoryCount?: number;
    errorMessage?: string;
    stages: Array<{
      stage: "search" | "cluster" | "fetch" | "synthesize" | "validate" | "publish";
      status: "running" | "succeeded" | "failed" | "skipped";
      inputCount?: number;
      outputCount?: number;
      durationMs?: number;
      details?: Record<string, number | string | boolean>;
      errorMessage?: string;
    }>;
    evaluation?: AgentQualityEvaluation;
  } | null;
  history: AgentRunHistoryItem[];
};

type AgentRunHistoryItem = {
  id: string;
  digestDate: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
  publishedStoryCount?: number;
};

type AgentQualityEvaluation = {
  evaluationVersion: "v1";
  freshnessScore: number;
  multiSourceCoverage: number;
  averageSourcesPerStory: number;
  sourceDomainCount: number;
  categoryCoverage: number;
  duplicateFreeRate: number;
  citationUrlValidity: number;
};
```

## 界面与运行约束

- 首页入口只打开只读弹窗，新闻浏览与详情页不依赖控制台接口。
- 首次打开弹窗请求数据；弹窗关闭后不轮询。运行中的任务最多每 5 秒刷新一次，并在完成后自动停止刷新。
- 当没有任何运行记录时，展示“尚无生成记录”，不调用 Agent。
- 当数据接口不可用时，仅在弹窗内显示可恢复错误状态，不影响首页日报。
- 最近运行历史最多返回 14 条，阶段详情默认只展示最近一次运行。

## 验收标准

1. 每次日报运行都能在成功或失败后留下可解释的阶段记录。
2. 成功运行可获得一组版本化、确定性计算的质量指标。
3. 控制台接口和界面不泄露任何密钥、提示词、完整正文或匿名对话内容。
4. 控制台数据缺失、失败或加载中时，首页新闻列表仍可独立正常使用。
