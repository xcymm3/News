import Link from "next/link";
import { notFound } from "next/navigation";

import { StoryQuestionPanel } from "@/features/chat/story-question-panel";
import { digestService } from "@/features/digest/digest-service";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

function formatDateTime(isoDate: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Shanghai",
  }).format(new Date(isoDate));
}

function formatDate(isoDate: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(new Date(isoDate));
}

export default async function StoryDetailPage({
  params,
}: {
  params: Promise<{ storyId: string }>;
}) {
  const { storyId } = await params;
  const digest = await digestService.getTodayDigest();
  const story = digest.stories.find((item) => item.id === storyId);

  if (!story) {
    notFound();
  }

  const sourceCitations = [...new Map(story.citations.map((citation) => [citation.sourceName, citation])).values()];

  return (
    <div className={styles.page}>
      <main className={styles.shell}>
        <header className={styles.utilityBar}>
          <Link className={styles.backLink} href="/">
            返回标题列表
          </Link>
          <p className={styles.issueLine}>
            全球简报 · {formatDate(digest.publishedAt)} · Vol. {String(digest.revision).padStart(2, "0")}
          </p>
        </header>

        <article className={styles.article}>
          <header className={styles.articleHeader}>
            <p className={styles.meta}>
              {digest.isDemoData
                ? "虚构演示数据"
                : digest.generationMode === "agent"
                  ? "AI Agent 整理 · 未独立核验"
                  : "自动整理候选 · 未独立核验"} · 第 {story.position} 条
            </p>
            <h1 className={styles.title}>{story.headline}</h1>
            <p className={styles.updatedAt}>
              <time dateTime={story.updatedAt}>更新于 {formatDateTime(story.updatedAt)}</time>
            </p>
          </header>

          <section className={styles.summary} aria-label="新闻摘要">
            <p className={styles.bodyText}>{story.summary}</p>
          </section>

          <section className={styles.sources} aria-labelledby="story-sources-heading">
            <h2 className={styles.sourcesTitle} id="story-sources-heading">
              原网站来源
            </h2>
            <ul className={styles.sourceList}>
              {sourceCitations.map((citation) => (
                <li key={citation.id}>
                  <a className={styles.sourceLink} href={citation.sourceUrl} rel="noopener noreferrer" target="_blank">
                    {citation.sourceName}
                    <span aria-hidden="true"> ↗</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <StoryQuestionPanel isDemoData={digest.isDemoData} key={story.id} storyId={story.id} />
        </article>
      </main>
    </div>
  );
}
