import Link from "next/link";

import styles from "./recovery-page.module.css";

export default function NotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="not-found-heading">
        <p className={styles.eyebrow}>404 · 条目未找到</p>
        <h1 className={styles.title} id="not-found-heading">
          这条新闻不在当前日报中
        </h1>
        <p className={styles.copy}>实时来源更新后，旧链接可能不再对应今天的候选条目。</p>
        <div className={styles.actions}>
          <Link className={styles.primaryAction} href="/">
            查看今日标题
          </Link>
        </div>
      </section>
    </main>
  );
}
