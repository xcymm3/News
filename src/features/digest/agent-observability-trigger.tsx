"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentObservabilitySnapshot,
  AgentQualityEvaluationSnapshot,
  AgentRunEventDecisionSnapshot,
  AgentRunSnapshot,
  AgentRunStageSnapshot,
} from "./agent-observability-contract";
import styles from "./agent-observability-trigger.module.css";

const STAGES: Array<{ stage: AgentRunStageSnapshot["stage"]; label: string; description: string }> = [
  { stage: "search", label: "检索", description: "主题搜索与候选网页汇总" },
  { stage: "cluster", label: "聚类", description: "去重、事件归并与多源筛选" },
  { stage: "fetch", label: "读取", description: "读取入选网页的正文材料" },
  { stage: "synthesize", label: "综合", description: "按事件整合多源信息" },
  { stage: "validate", label: "校验", description: "检查摘要、引用与重复事件" },
  { stage: "publish", label: "发布", description: "写入日报与关联来源" },
];

const STAGE_DETAIL_LABELS: Record<string, string> = {
  successfulTopicCount: "成功主题",
  skippedTopicCount: "跳过主题",
  rssConfiguredSourceCount: "RSS 配置源",
  rssAvailableSourceCount: "可用 RSS 源",
  rssArticleCount: "RSS 取回条数",
  rssCandidateCount: "RSS 入池条数",
  rssChinanewsCount: "中国新闻网",
  rss36KrCount: "36氪",
  rssCnaInternationalCount: "中央社国际",
  rssIthomeCount: "IT之家",
  rssHuxiuCount: "虎嗅",
  bochaCandidateCount: "博查取回条数",
  rssSelectedCandidateCount: "RSS 待读取",
  bochaSelectedCandidateCount: "博查待读取",
  searchRetryCount: "搜索重试次数",
  searchFailureReason: "搜索失败原因",
  insufficientSourceRejectedCount: "来源不足淘汰",
  multiSourceCandidateCount: "双来源候选",
  singleSourceReserveCount: "单来源候补",
  fetchRetryCount: "读取重试次数",
  fetchFailedCount: "读取失败条数",
  fetchFailureReason: "读取失败原因",
  promptTokens: "输入 Token",
  completionTokens: "输出 Token",
  totalTokens: "总 Token",
  estimatedCostCny: "费用估算（元）",
  llmRetryCount: "模型重试次数",
  llmRejectedEventCount: "模型淘汰事件",
  llmFailureReason: "模型失败原因",
  maxRetriesPerEvent: "单事件最大重试",
  minimumSourceDomains: "最低来源数",
  maximumClusters: "候选上限",
  maximumSourcesPerEvent: "单事件上限",
  sourceDocumentCount: "来源网页",
  model: "模型",
  provider: "提供方",
};

const EVENT_REASON_LABELS: Record<string, string> = {
  INSUFFICIENT_SOURCES: "独立来源不足 2 个",
  NO_READABLE_SOURCES: "没有可读取的原文材料",
  RANKED_BELOW_CANDIDATE_CUTOFF: "候选阶段评分未进入前列",
  INSUFFICIENT_READABLE_SOURCES: "可读取的独立来源不足 2 个",
  MODEL_CANDIDATE: "进入 DeepSeek 的 20 条候选",
  RANKED_BELOW_MODEL_CUTOFF: "未进入 DeepSeek 的 20 条候选",
  MODEL_OUTPUT_INVALID: "DeepSeek 未返回合规 JSON",
  TOP_SELECTION_SCORE: "综合评分进入最终选题",
  RANKED_BELOW_FINAL_CUTOFF: "综合评分未进入最终选题",
};

const STAGE_HIGHLIGHT_KEYS: Partial<Record<AgentRunStageSnapshot["stage"], string[]>> = {
  search: ["rssArticleCount", "bochaCandidateCount", "rssAvailableSourceCount"],
  cluster: ["multiSourceCandidateCount", "singleSourceReserveCount", "insufficientSourceRejectedCount"],
  fetch: ["fetchFailedCount", "fetchRetryCount"],
  synthesize: ["totalTokens", "estimatedCostCny", "llmRejectedEventCount"],
};

function ActivityIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M4 15h3l2-7 3 11 2-7h6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M5 12h13m-5-5 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function formatDuration(durationMs?: number) {
  if (durationMs === undefined) {
    return "—";
  }

  if (durationMs < 1_000) {
    return `${durationMs} ms`;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} 秒`;
  }

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  return `${minutes} 分 ${seconds} 秒`;
}

function formatDateTime(value?: string) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "—";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function formatCount(value?: number) {
  return value === undefined ? "—" : value.toLocaleString("zh-CN");
}

function formatScore(value: number) {
  return `${Math.round(value)}%`;
}

function formatStageDetailValue(key: string, value: string | number | boolean | null) {
  if (value === null) {
    return key === "estimatedCostCny" ? "未配置单价" : "无";
  }

  if (key === "estimatedCostCny" && typeof value === "number") {
    return `¥${value.toFixed(6)}`;
  }

  return String(value);
}

function getRunStatusLabel(status: AgentRunSnapshot["status"]) {
  return {
    running: "运行中",
    succeeded: "已完成",
    failed: "已失败",
  }[status];
}

function getStageStatusLabel(status?: AgentRunStageSnapshot["status"]) {
  if (!status) {
    return "未记录";
  }

  return {
    running: "运行中",
    succeeded: "完成",
    failed: "失败",
    skipped: "跳过",
  }[status];
}

function getTriggerLabel(trigger: AgentRunSnapshot["trigger"]) {
  return trigger === "cron" ? "定时任务" : "手动运行";
}

function isSnapshotPayload(value: unknown): value is { data: AgentObservabilitySnapshot } {
  return typeof value === "object"
    && value !== null
    && "data" in value
    && typeof value.data === "object"
    && value.data !== null
    && "latestRun" in value.data
    && "history" in value.data;
}

function getResponseErrorMessage(value: unknown) {
  if (
    typeof value === "object"
    && value !== null
    && "error" in value
    && typeof value.error === "object"
    && value.error !== null
    && "message" in value.error
    && typeof value.error.message === "string"
  ) {
    return value.error.message;
  }

  return "暂时无法读取 Agent 运行记录，请稍后重试。";
}

function QualityMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className={styles.qualityMetric}>
      <span className={styles.qualityLabel}>{label}</span>
      <strong className={styles.qualityValue}>{value}</strong>
      <span className={styles.qualityHint}>{hint}</span>
    </div>
  );
}

function QualityPanel({ evaluation }: { evaluation?: AgentQualityEvaluationSnapshot }) {
  if (!evaluation) {
    return (
      <section className={styles.section} aria-labelledby="quality-heading">
        <div className={styles.sectionHeading}>
          <p className={styles.sectionIndex}>04</p>
          <h3 id="quality-heading">质量评估</h3>
        </div>
        <p className={styles.mutedMessage}>本次运行尚未生成质量评估。成功发布后的新日报会自动计算。</p>
      </section>
    );
  }

  return (
    <section className={styles.section} aria-labelledby="quality-heading">
      <div className={styles.sectionHeading}>
        <p className={styles.sectionIndex}>04</p>
        <h3 id="quality-heading">质量评估</h3>
        <span className={styles.version}>算法 {evaluation.evaluationVersion}</span>
      </div>
      <div className={styles.qualityGrid}>
        <QualityMetric hint="来源发布时间" label="时效性" value={formatScore(evaluation.freshnessScore)} />
        <QualityMetric hint="至少两域名" label="多源覆盖" value={formatScore(evaluation.multiSourceCoverage)} />
        <QualityMetric hint="标题相似度检查" label="去重率" value={formatScore(evaluation.duplicateFreeRate)} />
        <QualityMetric hint="平均独立域名" label="每条来源" value={evaluation.averageSourcesPerStory.toFixed(1)} />
      </div>
      <p className={styles.evaluationNote}>指标衡量流程健康度与来源结构，不代表对新闻事实的独立核验。</p>
    </section>
  );
}

function getEventDecisionStatusLabel(decision: AgentRunEventDecisionSnapshot["decision"]) {
  return decision === "selected" ? "入选" : "淘汰";
}

function formatDecisionScoreDetails(details?: AgentRunEventDecisionSnapshot["scoreDetails"]) {
  if (!details) {
    return "—";
  }

  const freshness = typeof details.freshnessScore === "number" ? `时效 ${details.freshnessScore}/45` : null;
  const source = typeof details.sourceScore === "number" ? `多源 ${details.sourceScore}/35` : null;
  const corroboration = typeof details.corroborationScore === "number" ? `佐证 ${details.corroborationScore}/20` : null;

  return [freshness, source, corroboration].filter(Boolean).join(" · ") || "—";
}

function EventDecisionItem({ item }: { item: AgentRunEventDecisionSnapshot }) {
  return (
    <li className={styles.decisionItem}>
      <div>
        <p className={styles.decisionHeadline}>{item.headline}</p>
        <p className={styles.decisionMeta}>{formatDecisionScoreDetails(item.scoreDetails)} · 来源 {item.sourceDomainCount} 个</p>
      </div>
      <div className={styles.decisionSide}>
        <strong>{item.score ?? "—"}</strong>
        <span className={`${styles.statusBadge} ${item.decision === "selected" ? styles.statussucceeded : styles.statusfailed}`}>{getEventDecisionStatusLabel(item.decision)}</span>
      </div>
    </li>
  );
}

function EventDecisionPanel({ decisions }: { decisions: AgentRunEventDecisionSnapshot[] }) {
  const finalSelection = decisions.filter((decision) => decision.phase === "final_selection");
  const selectedEvents = finalSelection.filter((item) => item.decision === "selected");
  const rejectedAtFinalSelection = finalSelection.filter((item) => item.decision === "rejected");
  const rejectedForSources = decisions.filter((decision) => (
    decision.decision === "rejected"
    && (decision.reason === "INSUFFICIENT_SOURCES" || decision.reason === "INSUFFICIENT_READABLE_SOURCES")
  ));

  return (
    <section className={styles.section} aria-labelledby="selection-heading">
      <div className={styles.sectionHeading}>
        <p className={styles.sectionIndex}>03</p>
        <h3 id="selection-heading">选题决策</h3>
        <span className={styles.historyCount}>最终 {selectedEvents.length} 条</span>
      </div>
      {decisions.length === 0 ? (
        <p className={styles.mutedMessage}>旧运行没有保存事件级决策。下一次运行会记录候选淘汰与最终评分。</p>
      ) : (
        <>
          <p className={styles.decisionIntro}>按时效、多源覆盖与佐证数量评分；以下展示得分最高的 3 条入选事件。</p>
          <ol className={styles.decisionList}>
            {selectedEvents.slice(0, 3).map((item) => <EventDecisionItem item={item} key={`${item.phase}-${item.candidateId}`} />)}
          </ol>
          <div className={styles.rejectedEvents}>
            <p>候选淘汰：来源不足 {rejectedForSources.length} 个 · 最终评分未入选 {rejectedAtFinalSelection.length} 个</p>
          </div>
          {(finalSelection.length > 3 || rejectedForSources.length > 0) && (
            <details className={styles.detailDisclosure}>
              <summary>查看全部选题决策与淘汰样本</summary>
              <ol className={styles.decisionList}>
                {finalSelection.map((item) => <EventDecisionItem item={item} key={`${item.phase}-${item.candidateId}`} />)}
              </ol>
              {rejectedForSources.length > 0 && (
                <ul className={styles.rejectionSampleList}>
                  {rejectedForSources.slice(0, 8).map((item) => (
                    <li key={`${item.phase}-${item.candidateId}`}>{item.headline} · {EVENT_REASON_LABELS[item.reason]}</li>
                  ))}
                </ul>
              )}
            </details>
          )}
        </>
      )}
    </section>
  );
}

function PipelinePanel({ run }: { run: AgentRunSnapshot }) {
  const stageByName = new Map(run.stages.map((stage) => [stage.stage, stage]));

  return (
    <section className={styles.section} aria-labelledby="pipeline-heading">
      <div className={styles.sectionHeading}>
        <p className={styles.sectionIndex}>02</p>
        <h3 id="pipeline-heading">运行漏斗</h3>
      </div>
      <ol className={styles.pipeline}>
        {STAGES.map((definition, index) => {
          const stage = stageByName.get(definition.stage);
          const statusClass = stage ? styles[`status${stage.status}`] : styles.statusPending;
          const highlightKeys = STAGE_HIGHLIGHT_KEYS[definition.stage] ?? [];
          const highlightedDetails = highlightKeys.flatMap((key) => (
            stage?.details && key in stage.details ? [[key, stage.details[key]] as const] : []
          ));
          const remainingDetails = Object.entries(stage?.details ?? {}).filter(([key]) => !highlightKeys.includes(key));

          return (
            <li className={styles.pipelineItem} key={definition.stage}>
              <span className={styles.pipelineNumber}>{String(index + 1).padStart(2, "0")}</span>
              <div className={styles.pipelineMain}>
                <div className={styles.pipelineTitleRow}>
                  <div>
                    <p className={styles.pipelineTitle}>{definition.label}</p>
                    <p className={styles.pipelineDescription}>{definition.description}</p>
                  </div>
                  <span className={`${styles.statusBadge} ${statusClass}`}>{getStageStatusLabel(stage?.status)}</span>
                </div>
                <div className={styles.pipelineMetrics}>
                  <span>{formatCount(stage?.inputCount)}</span>
                  <ArrowIcon />
                  <span>{formatCount(stage?.outputCount)}</span>
                  <span className={styles.pipelineDuration}>{formatDuration(stage?.durationMs)}</span>
                </div>
                {highlightedDetails.length > 0 && (
                  <div className={styles.stageDetails}>
                    {highlightedDetails.map(([key, value]) => (
                      <span key={key}>{STAGE_DETAIL_LABELS[key] ?? key}：{formatStageDetailValue(key, value)}</span>
                    ))}
                  </div>
                )}
                {stage?.errorMessage && <p className={styles.stageError}>{stage.errorMessage}</p>}
                {remainingDetails.length > 0 && (
                  <details className={styles.detailDisclosure}>
                    <summary>查看 {remainingDetails.length} 项运行参数</summary>
                    <div className={styles.stageDetails}>
                      {remainingDetails.map(([key, value]) => (
                        <span key={key}>{STAGE_DETAIL_LABELS[key] ?? key}：{formatStageDetailValue(key, value)}</span>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function HistoryPanel({ snapshot }: { snapshot: AgentObservabilitySnapshot }) {
  return (
    <section className={styles.section} aria-labelledby="history-heading">
      <div className={styles.sectionHeading}>
        <p className={styles.sectionIndex}>05</p>
        <h3 id="history-heading">最近运行</h3>
        <span className={styles.historyCount}>{snapshot.history.length} 条</span>
      </div>
      {snapshot.history.length === 0 ? (
        <p className={styles.mutedMessage}>尚无日报生成记录。</p>
      ) : (
        <>
          <ol className={styles.historyList}>
            {snapshot.history.slice(0, 3).map((run) => (
              <li className={styles.historyItem} key={run.id}>
                <div>
                  <p className={styles.historyDate}>{run.digestDate}</p>
                  <p className={styles.historyMeta}>{getTriggerLabel(run.trigger)} · {formatDateTime(run.startedAt)} · {formatDuration(run.totalDurationMs)}</p>
                </div>
                <div className={styles.historySide}>
                  <span className={`${styles.statusBadge} ${styles[`status${run.status}`]}`}>{getRunStatusLabel(run.status)}</span>
                  {run.evaluation && <span className={styles.historyScore}>质 {formatScore(run.evaluation.freshnessScore)}</span>}
                </div>
              </li>
            ))}
          </ol>
          {snapshot.history.length > 3 && (
            <details className={styles.detailDisclosure}>
              <summary>查看其余 {snapshot.history.length - 3} 次运行</summary>
              <ol className={styles.historyList}>
                {snapshot.history.slice(3).map((run) => (
                  <li className={styles.historyItem} key={run.id}>
                    <div>
                      <p className={styles.historyDate}>{run.digestDate}</p>
                      <p className={styles.historyMeta}>{getTriggerLabel(run.trigger)} · {formatDateTime(run.startedAt)} · {formatDuration(run.totalDurationMs)}</p>
                    </div>
                    <div className={styles.historySide}>
                      <span className={`${styles.statusBadge} ${styles[`status${run.status}`]}`}>{getRunStatusLabel(run.status)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function DashboardContent({ snapshot }: { snapshot: AgentObservabilitySnapshot }) {
  const run = snapshot.latestRun;

  if (!run) {
    return <p className={styles.emptyState}>尚无生成记录。系统在下一次日报任务运行后会开始积累可观测数据。</p>;
  }

  return (
    <>
      <section className={styles.runOverview} aria-labelledby="run-overview-heading">
        <div className={styles.runHeading}>
          <div>
            <p className={styles.sectionIndex}>01</p>
            <h3 id="run-overview-heading">本次运行</h3>
          </div>
          <span className={`${styles.statusBadge} ${styles[`status${run.status}`]}`}>{getRunStatusLabel(run.status)}</span>
        </div>
        <div className={styles.runMeta}>
          <span>{run.digestDate}</span>
          <span>{getTriggerLabel(run.trigger)}</span>
          {run.model && <span>{run.model}</span>}
        </div>
        <div className={styles.overviewGrid}>
          <div><span>总耗时</span><strong>{formatDuration(run.totalDurationMs)}</strong></div>
          <div><span>读取网页</span><strong>{formatCount(run.retrievedDocumentCount)}</strong></div>
          <div><span>发布事件</span><strong>{formatCount(run.publishedStoryCount)}</strong></div>
        </div>
        {run.errorMessage && <p className={styles.runError}>{run.errorMessage}</p>}
      </section>
      <PipelinePanel run={run} />
      <EventDecisionPanel decisions={run.eventDecisions} />
      <QualityPanel evaluation={run.evaluation} />
      <HistoryPanel snapshot={snapshot} />
    </>
  );
}

function LoadingState() {
  return (
    <div className={styles.loadingState} aria-label="正在读取运行记录">
      <span /><span /><span />
    </div>
  );
}

export function AgentObservabilityTrigger() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<AgentObservabilitySnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSnapshot = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setIsLoading(true);
    }

    try {
      const response = await fetch("/api/admin/agent-observability", { cache: "no-store" });
      const payload: unknown = await response.json();

      if (!response.ok || !isSnapshotPayload(payload)) {
        throw new Error(getResponseErrorMessage(payload));
      }

      setSnapshot(payload.data);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "暂时无法读取 Agent 运行记录，请稍后重试。");
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isOpen || snapshot?.latestRun?.status !== "running") {
      return undefined;
    }

    const refreshTimer = window.setInterval(() => {
      void loadSnapshot();
    }, 5_000);

    return () => window.clearInterval(refreshTimer);
  }, [isOpen, loadSnapshot, snapshot?.latestRun?.status]);

  const openDialog = () => {
    if (!dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
    setIsOpen(true);
    void loadSnapshot(true);
  };

  const closeDialog = () => {
    if (dialogRef.current?.open) {
      dialogRef.current.close();
    }
    setIsOpen(false);
  };

  return (
    <>
      <button className={styles.trigger} onClick={openDialog} type="button">
        <ActivityIcon />
        <span>运行详情</span>
      </button>

      <dialog
        aria-labelledby="agent-observability-title"
        className={styles.dialog}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeDialog();
          }
        }}
        onClose={() => setIsOpen(false)}
        ref={dialogRef}
      >
        <div className={styles.frame}>
          <header className={styles.header}>
            <div>
              <p className={styles.eyebrow}>AGENT OBSERVABILITY</p>
              <h2 className={styles.title} id="agent-observability-title">运行详情</h2>
            </div>
            <button aria-label="关闭运行详情" className={styles.closeButton} onClick={closeDialog} type="button">
              <CloseIcon />
            </button>
          </header>

          {isLoading && !snapshot ? <LoadingState /> : <DashboardContent snapshot={snapshot ?? { latestRun: null, history: [] }} />}
          {errorMessage && (
            <div className={styles.errorState} role="status">
              <p>{errorMessage}</p>
              <button onClick={() => void loadSnapshot(true)} type="button">重新加载</button>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
