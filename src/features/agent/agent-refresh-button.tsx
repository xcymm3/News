"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import styles from "@/app/page.module.css";

export function AgentRefreshButton() {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [isRefreshing, startTransition] = useTransition();
  const [message, setMessage] = useState("测试模式：点击后才会调用 LangChain Agent、全网搜索与原文阅读工具。");
  const [error, setError] = useState<string | null>(null);

  const runAgent = async () => {
    if (isRunning || isRefreshing) {
      return;
    }

    setError(null);
    setIsRunning(true);
    setMessage("Agent 正在全网检索、阅读原文并校验引用…");

    try {
      const response = await fetch("/api/agent/digest", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        data?: { digest?: { stories?: unknown[] } };
        meta?: { searchProvider?: string; retrievedDocumentCount?: number };
        error?: { message?: string };
      };

      if (!response.ok || !payload.data?.digest) {
        throw new Error(payload.error?.message ?? "全网研究 Agent 暂时无法生成日报，请稍后重试。");
      }

      const storyCount = payload.data.digest.stories?.length ?? 0;
      const providerLabel = payload.meta?.searchProvider ? `使用 ${payload.meta.searchProvider} 全网检索` : "已完成一次全网检索";
      const sourceCount = payload.meta?.retrievedDocumentCount ?? 0;

      setMessage(`${providerLabel}，阅读 ${sourceCount} 篇原文：生成 ${storyCount} 条带出处的日报。`);
      startTransition(() => {
        router.refresh();
      });
    } catch (caughtError) {
      const nextError = caughtError instanceof Error ? caughtError.message : "全网研究 Agent 暂时无法生成日报，请稍后重试。";

      setError(nextError);
      setMessage("当前页面未被替换；可检查配置后再次尝试。");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <section className={styles.agentControl} aria-label="AI Agent 新闻整理">
      <div>
        <p className={styles.agentControlTitle}>AI Agent 测试</p>
        <p className={error ? styles.agentControlError : styles.agentControlHint} role={error ? "alert" : "status"}>
          {error ?? message}
        </p>
      </div>
      <button className={styles.agentButton} disabled={isRunning || isRefreshing} onClick={runAgent} type="button">
        {isRunning || isRefreshing ? "正在整理…" : "运行 Agent →"}
      </button>
    </section>
  );
}
