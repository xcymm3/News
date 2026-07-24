"use client";

import Link from "next/link";
import { useEffect } from "react";

import styles from "./recovery-page.module.css";

export default function ErrorPage({
  error,
  unstable_retry: unstableRetry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Unexpected application error.", error);
  }, [error]);

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="error-heading">
        <p className={styles.eyebrow}>暂时无法打开</p>
        <h1 className={styles.title} id="error-heading">
          页面遇到了临时问题
        </h1>
        <p className={styles.copy}>请重试；若问题持续出现，可以先返回今日标题列表。</p>
        <div className={styles.actions}>
          <button className={styles.primaryAction} onClick={() => unstableRetry()} type="button">
            重新加载
          </button>
          <Link className={styles.secondaryAction} href="/">
            返回首页
          </Link>
        </div>
      </section>
    </main>
  );
}
