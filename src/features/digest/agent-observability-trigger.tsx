"use client";

import { useRef } from "react";

import styles from "./agent-observability-trigger.module.css";

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

export function AgentObservabilityTrigger() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const openDialog = () => {
    dialogRef.current?.showModal();
  };

  const closeDialog = () => {
    dialogRef.current?.close();
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

          <div className={styles.placeholder}>
            <span className={styles.placeholderMark} aria-hidden="true">01</span>
            <div>
              <p className={styles.placeholderTitle}>Agent 运行记录</p>
              <p className={styles.placeholderText}>正在准备本次生成的检索、聚类、校验与质量评估信息。</p>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
