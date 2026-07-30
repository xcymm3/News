import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

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

function renderInlineMarkdown(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => (
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part
  ));
}

function normalizeSummaryMarkdown(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    // Some models put a heading and its opening sentence on the same line.
    // Split the common date/context openings so the stored digest remains readable.
    .replace(
      /^(#{1,3}\s+)(.{1,72}?)(?:：|:)(?=\s*(?:截至|目前|据|当地时间|20\d{2}年|\d{1,2}月))/gm,
      "$1$2\n\n",
    )
    .replace(
      /^(#{1,3}\s+)(.{1,72}?)(?=\s+(?:截至|目前|据|当地时间|20\d{2}年|\d{1,2}月))/gm,
      "$1$2\n\n",
    );
}

function renderSummaryMarkdown(value: string) {
  return normalizeSummaryMarkdown(value).trim().split(/\n{2,}/).filter(Boolean).flatMap((block, index) => {
    const lines = block.trim().split("\n").map((line) => line.trim()).filter(Boolean);
    const heading = /^#{1,3}\s+(.+)$/.exec(lines[0] ?? "");
    const contentLines = heading ? lines.slice(1) : lines;
    const nodes: ReactNode[] = [];

    if (heading) {
      nodes.push(<h2 className={styles.summaryHeading} key={`${index}-heading`}>{renderInlineMarkdown(heading[1]!)}</h2>);
    }

    if (contentLines.length > 0 && contentLines.every((line) => /^[-*]\s+/.test(line))) {
      nodes.push(
        <ul className={styles.summaryList} key={index}>
          {contentLines.map((line, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>)}
        </ul>,
      );
    } else if (contentLines.length > 0) {
      nodes.push(<p className={styles.bodyText} key={`${index}-body`}>{renderInlineMarkdown(contentLines.join(" "))}</p>);
    }

    return nodes;
  });
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
        <nav aria-label="详情页导航" className={styles.utilityBar}>
          <Link className={styles.backLink} href="/">
            返回标题列表
          </Link>
        </nav>

        <article className={styles.article}>
          <header className={styles.articleHeader}>
            <h1 className={styles.title}>{story.headline}</h1>
            <p className={styles.updatedAt}>
              <time dateTime={story.updatedAt}>更新于 {formatDateTime(story.updatedAt)}</time>
            </p>
          </header>

          <section className={styles.summary} aria-label="新闻摘要">
            {renderSummaryMarkdown(story.summary)}
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
        </article>
      </main>
      <StoryQuestionPanel key={story.id} storyId={story.id} />
    </div>
  );
}
