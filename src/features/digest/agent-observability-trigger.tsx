"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentObservabilitySnapshot,
  AgentQualityEvaluationSnapshot,
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
  minimumSourceDomains: "最低来源数",
  maximumClusters: "候选上限",
  maximumSourcesPerEvent: "单事件上限",
  sourceDocumentCount: "来源网页",
  model: "模型",
  provider: "提供方",
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
          <p className={styles.sectionIndex}>03</p>
          <h3 id="quality-heading">质量评估</h3>
        </div>
        <p className={styles.mutedMessage}>本次运行尚未生成质量评估。成功发布后的新日报会自动计算。</p>
      </section>
    );
  }

  return (
    <section className={styles.section} aria-labelledby="quality-heading">
      <div className={styles.sectionHeading}>
        <p className={styles.sectionIndex}>03</p>
        <h3 id="quality-heading">质量评估</h3>
        <span className={styles.version}>算法 {evaluation.evaluationVersion}</span>
      </div>
      <div className={styles.qualityGrid}>
        <QualityMetric hint="来源发布时间" label="时效性" value={formatScore(evaluation.freshnessScore)} />
        <QualityMetric hint="至少两域名" label="多源覆盖" value={formatScore(evaluation.multiSourceCoverage)} />
        <QualityMetric hint="标题相似度检查" label="去重率" value={formatScore(evaluation.duplicateFreeRate)} />
        <QualityMetric hint="合法 HTTP(S)" label="引用有效" value={formatScore(evaluation.citationUrlValidity)} />
        <QualityMetric hint="平均独立域名" label="每条来源" value={evaluation.averageSourcesPerStory.toFixed(1)} />
        <QualityMetric hint="本次引用站点" label="独立域名" value={formatCount(evaluation.sourceDomainCount)} />
      </div>
      <p className={styles.evaluationNote}>指标衡量流程健康度与来源结构，不代表对新闻事实的独立核验。</p>
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
                {stage?.details && (
                  <div className={styles.stageDetails}>
                    {Object.entries(stage.details).map(([key, value]) => (
                      <span key={key}>{STAGE_DETAIL_LABELS[key] ?? key}：{String(value)}</span>
                    ))}
                  </div>
                )}
                {stage?.errorMessage && <p className={styles.stageError}>{stage.errorMessage}</p>}
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
        <p className={styles.sectionIndex}>04</p>
        <h3 id="history-heading">最近运行</h3>
        <span className={styles.historyCount}>{snapshot.history.length} 条</span>
      </div>
      {snapshot.history.length === 0 ? (
        <p className={styles.mutedMessage}>尚无日报生成记录。</p>
      ) : (
        <ol className={styles.historyList}>
          {snapshot.history.map((run) => (
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
        <span>生成详情</span>
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
              <h2 className={styles.title} id="agent-observability-title">生成详情</h2>
            </div>
            <button aria-label="关闭生成详情" className={styles.closeButton} onClick={closeDialog} type="button">
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
