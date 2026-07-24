"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import type {
  StoryChatMessage,
  StoryQuestionResponse,
} from "./types";
import styles from "./story-question-panel.module.css";

type StoryQuestionPanelProps = {
  storyId: string;
  isDemoData: boolean;
};

function makeMessageId(role: StoryChatMessage["role"]) {
  return `${role}-${crypto.randomUUID()}`;
}

export function StoryQuestionPanel({ storyId, isDemoData }: StoryQuestionPanelProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const dialogInputRef = useRef<HTMLTextAreaElement>(null);
  const [messages, setMessages] = useState<StoryChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const openDialog = () => {
    setIsExpanded(true);
  };

  const closeDialog = () => {
    if (!isSubmitting) {
      setIsExpanded(false);
    }
  };

  useEffect(() => {
    if (!isExpanded) {
      return;
    }

    const focusInput = window.requestAnimationFrame(() => dialogInputRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        setIsExpanded(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.cancelAnimationFrame(focusInput);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isExpanded, isSubmitting]);

  const submitQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedQuestion = draft.trim();

    if (!normalizedQuestion || isSubmitting) {
      return;
    }

    setError(null);
    setDraft("");
    const optimisticMessage: StoryChatMessage = {
      id: makeMessageId("user"),
      role: "user",
      content: normalizedQuestion,
      createdAt: new Date().toISOString(),
    };

    const recentTurns = messages.slice(-8).map((message) => ({
      role: message.role,
      content: message.content,
    }));

    setMessages((currentMessages) => [...currentMessages, optimisticMessage]);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/story-questions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          storyId,
          question: normalizedQuestion,
          recentTurns,
        }),
      });
      const payload = (await response.json()) as StoryQuestionResponse & {
        error?: { message?: string };
      };

      if (!response.ok || !payload.data?.answer) {
        throw new Error(payload.error?.message ?? "暂时无法整理回答，请稍后重试。");
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: makeMessageId("assistant"),
          role: "assistant",
          content: payload.data.answer.answer,
          citations: payload.data.answer.citations,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (caughtError) {
      setMessages((currentMessages) => currentMessages.filter((message) => message.id !== optimisticMessage.id));
      setDraft(normalizedQuestion);
      setError(caughtError instanceof Error ? caughtError.message : "暂时无法整理回答，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <aside className={styles.dock} aria-label="AI 追问入口">
        <div className={styles.dockInner}>
          <input
            aria-label="向 AI 提问"
            className={styles.dockInput}
            onChange={(event) => {
              setDraft(event.target.value);
              openDialog();
            }}
            onFocus={openDialog}
            placeholder="向 AI 追问这条新闻…"
            value={draft}
          />
          <button className={styles.expandButton} onClick={openDialog} type="button">
            展开
          </button>
        </div>
      </aside>

      {isExpanded ? (
        <div className={styles.backdrop} onMouseDown={(event) => event.currentTarget === event.target && closeDialog()}>
          <section aria-labelledby="story-question-heading" aria-modal="true" className={styles.dialog} role="dialog">
            <header className={styles.dialogHeader}>
              <div>
                <p className={styles.dialogEyebrow}>AI 对话</p>
                <h2 className={styles.dialogTitle} id="story-question-heading">
                  围绕这条新闻继续问
                </h2>
              </div>
              <button className={styles.collapseButton} disabled={isSubmitting} onClick={closeDialog} type="button">
                收起
              </button>
            </header>

            <div className={styles.conversation}>
              {messages.length > 0 ? (
                <ol className={styles.thread} aria-live="polite" aria-label="本次 AI 对话">
                  {messages.map((message) => (
                    <li
                      className={`${styles.message} ${message.role === "assistant" ? styles.assistantMessage : ""}`}
                      key={message.id}
                    >
                      <span className={styles.messageMeta}>{message.role === "user" ? "你" : "AI"}</span>
                      <p className={styles.messageText}>{message.content}</p>
                      {message.citations && message.citations.length > 0 ? (
                        <ul className={styles.citationList} aria-label="相关原文">
                          {message.citations.map((citation) => (
                            <li key={citation.id}>
                              <a className={styles.citationLink} href={citation.sourceUrl} rel="noopener noreferrer" target="_blank">
                                原文：{citation.sourceName}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <div className={styles.emptyState}>
                  <p>问背景、概念或这条新闻的后续影响。</p>
                  <p>{isDemoData ? "演示新闻的事实以本页内容为准。" : "当前新闻的事实以 RSS 材料为准。"}</p>
                </div>
              )}
            </div>

            <form className={styles.dialogComposer} onSubmit={submitQuestion}>
              <label className={styles.label} htmlFor={inputId}>
                你的问题
              </label>
              <textarea
                aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                aria-invalid={Boolean(error)}
                className={styles.textarea}
                disabled={isSubmitting}
                id={inputId}
                maxLength={500}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError(null);
                }}
                placeholder="例如：这会怎样影响市场？"
                ref={dialogInputRef}
                required
                value={draft}
              />
              <div className={styles.formFooter}>
                <p className={styles.hint} id={hintId}>
                  最近 8 条对话仅在本页上下文中使用。
                </p>
                <button className={styles.submitButton} disabled={isSubmitting || !draft.trim()} type="submit">
                  {isSubmitting ? "正在回答" : "发送"}
                </button>
              </div>
              {error ? (
                <p className={styles.error} id={errorId} role="alert">
                  {error}
                </p>
              ) : null}
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
