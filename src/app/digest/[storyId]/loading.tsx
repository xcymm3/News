import styles from "./loading.module.css";

export default function StoryDetailLoading() {
  return (
    <div aria-busy="true" aria-label="正在加载新闻详情" className={styles.page} role="status">
      <main className={styles.shell}>
        <div className={`${styles.skeleton} ${styles.utility}`} />
        <article className={styles.article}>
          <header className={styles.header}>
            <div className={`${styles.skeleton} ${styles.meta}`} />
            <div className={`${styles.skeleton} ${styles.title}`} />
            <div className={`${styles.skeleton} ${styles.titleShort}`} />
          </header>
          <section className={styles.summary}>
            <div className={`${styles.skeleton} ${styles.line}`} />
            <div className={`${styles.skeleton} ${styles.line}`} />
            <div className={`${styles.skeleton} ${styles.lineMedium}`} />
            <div className={`${styles.skeleton} ${styles.lineShort}`} />
          </section>
          <section className={styles.sources}>
            <div className={`${styles.skeleton} ${styles.sourcesLabel}`} />
            <div className={styles.sourceRow}>
              <div className={`${styles.skeleton} ${styles.source}`} />
              <div className={`${styles.skeleton} ${styles.source}`} />
              <div className={`${styles.skeleton} ${styles.sourceShort}`} />
            </div>
          </section>
        </article>
      </main>
    </div>
  );
}
