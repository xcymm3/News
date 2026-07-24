import Link from "next/link";

import { AgentRefreshButton } from "@/features/agent/agent-refresh-button";
import { digestService } from "@/features/digest/digest-service";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

function formatDate(isoDate: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(new Date(isoDate));
}

export default async function Home() {
  const digest = await digestService.getTodayDigest();
  const digestLabel = digest.isDemoData ? "演示数据" : digest.generationMode === "agent" ? "AI Agent 整理" : "自动整理候选";

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main-content">
        跳至标题列表
      </a>
      <div className={styles.shell}>
        <header className={styles.masthead}>
          <div className={styles.mastMeta}>
            <span>全球简报</span>
            <time dateTime={digest.digestDate}>{formatDate(digest.publishedAt)}</time>
            <span>Vol. {String(digest.revision).padStart(2, "0")}</span>
          </div>
          <h1 className={styles.wordmark}>今日国际局势</h1>
          <p className={styles.strapline}>全球动向 · 每日更新 · {digestLabel}</p>
        </header>

        <AgentRefreshButton />

        <main id="main-content">
          <section aria-labelledby="feed-heading">
            <div className={styles.feedHeader}>
              <h2 className={styles.feedTitle} id="feed-heading">
                今日标题
              </h2>
              <p className={styles.feedMeta}>{digest.stories.length} 条更新</p>
            </div>
            <ol className={styles.feed} aria-label="今日新闻标题">
              {digest.stories.map((story) => (
                <li className={styles.feedItem} key={story.id}>
                  <Link
                    aria-label={`了解详情：${story.headline}`}
                    className={styles.storyLink}
                    href={`/digest/${story.id}`}
                  >
                    <span className={styles.headline}>{story.headline}</span>
                    <span className={styles.detailAction} aria-hidden="true">
                      了解详情 →
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        </main>
        <footer className={styles.footer}>
          {digest.isDemoData
            ? "局势索引 · 所有条目均为演示数据"
            : digest.generationMode === "agent"
              ? "局势索引 · AI Agent 基于联网检索整理，点开查看原始出处"
              : "局势索引 · 自动整理候选，点开查看原始出处"}
        </footer>
      </div>
    </div>
  );
}
