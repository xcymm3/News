import Link from "next/link";

import { AgentRefreshButton } from "@/features/agent/agent-refresh-button";
import { DigestNotFoundError, digestService } from "@/features/digest/digest-service";
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

function formatTime(isoDate: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Shanghai",
  }).format(new Date(isoDate));
}

function getStoryCategory(headline: string) {
  if (/人工智能|\bAI\b|芯片|机器人|科技|数字经济/i.test(headline)) {
    return "科技";
  }

  if (/市场|经济|贸易|金融|外汇|货币|央行|原油|投资|股市|价格|汇率/i.test(headline)) {
    return "财经";
  }

  if (/外交|国际|联合国|东盟|中东|美国|欧洲|乌克兰|伊朗|以色列|俄罗斯|全球/i.test(headline)) {
    return "国际";
  }

  return "时事";
}

export default async function Home() {
  let digest;

  try {
    digest = await digestService.getTodayDigest();
  } catch (error) {
    const isMissingDigest = error instanceof DigestNotFoundError;

    return (
      <div className={styles.page}>
        <div className={styles.shell}>
          <header className={styles.masthead}>
            <div className={styles.mastMeta}>
              <span>全球简报</span>
              <span>数据库日报</span>
              <span>今日</span>
            </div>
            <h1 className={styles.wordmark}>今日国际局势</h1>
            <p className={styles.strapline}>全球动向 · 每日更新 · 等待发布</p>
          </header>

          <AgentRefreshButton />

          <main className={styles.unavailable} id="main-content">
            <p className={styles.unavailableEyebrow}>日报暂不可用</p>
            <h2 className={styles.unavailableTitle}>{isMissingDigest ? "今日日报尚未生成" : "暂时无法读取数据库日报"}</h2>
            <p className={styles.unavailableText}>
              {isMissingDigest
                ? "请使用上方“运行 Agent”生成今天的首个日报。"
                : "请稍后刷新页面；若问题持续，请检查数据库连接配置。"}
            </p>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main-content">
        跳至标题列表
      </a>
      <div className={styles.shell}>
        <header className={styles.masthead}>
          <nav aria-label="简报导航" className={styles.navPill}>
            <Link className={styles.navBrand} href="/">局势</Link>
            <time className={styles.navDate} dateTime={digest.digestDate}>{formatDate(digest.publishedAt)}</time>
            <AgentRefreshButton compact />
          </nav>
          <div className={styles.mastheadContent}>
            <p className={styles.eyebrow}>GLOBAL BRIEFING</p>
            <h1 className={styles.wordmark}>今日国际局势</h1>
            <p className={styles.strapline}>快速浏览，按标题进入事件详情并继续追问。</p>
          </div>
        </header>

        <main id="main-content">
          <section aria-labelledby="feed-heading">
            <div className={styles.feedHeader}>
              <h2 className={styles.feedTitle} id="feed-heading">
                今日标题
              </h2>
              <p className={styles.feedMeta}>{digest.stories.length} 条更新</p>
            </div>
            <ol className={styles.feed} aria-label="今日新闻标题">
              {digest.stories.map((story) => {
                const category = getStoryCategory(story.headline);

                return (
                  <li className={styles.feedItem} key={story.id}>
                  <Link
                    aria-label={`了解详情：${story.headline}`}
                    className={styles.storyLink}
                    href={`/digest/${story.id}`}
                  >
                    <span className={`${styles.storyVisual} ${styles[`tone${(story.position % 4) + 1}`]}`} aria-hidden="true">
                      <span className={styles.storyCategory}>{category}</span>
                    </span>
                    <span className={styles.storyCopy}>
                      <span className={styles.headline}>{story.headline}</span>
                      <span className={styles.storyMeta}>全球简报 · {formatTime(story.updatedAt)}</span>
                    </span>
                  </Link>
                  </li>
                );
              })}
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
