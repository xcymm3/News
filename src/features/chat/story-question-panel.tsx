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

type AnswerBlock =
  | { type: "heading"; content: string }
  | { type: "paragraph"; content: string }
  | { type: "ordered-list"; items: string[] }
  | { type: "unordered-list"; items: string[] };

const headingPattern = /^#{1,3}\s+(.+)$/;
const orderedItemPattern = /^\d+[.)]\s+(.+)$/;
const unorderedItemPattern = /^[-*]\s+(.+)$/;

function parseAnswerBlocks(content: string): AnswerBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: AnswerBlock[] = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex].trim();

    if (!line) {
      lineIndex += 1;
      continue;
    }

    const headingMatch = line.match(headingPattern);
    if (headingMatch) {
      blocks.push({ type: "heading", content: headingMatch[1] });
      lineIndex += 1;
      continue;
    }

    const orderedMatch = line.match(orderedItemPattern);
    if (orderedMatch) {
      const items: string[] = [];

      while (lineIndex < lines.length) {
        const itemMatch = lines[lineIndex].trim().match(orderedItemPattern);
        if (!itemMatch) {
          break;
        }

        items.push(itemMatch[1]);
        lineIndex += 1;
      }

      blocks.push({ type: "ordered-list", items });
      continue;
    }

    const unorderedMatch = line.match(unorderedItemPattern);
    if (unorderedMatch) {
      const items: string[] = [];

      while (lineIndex < lines.length) {
        const itemMatch = lines[lineIndex].trim().match(unorderedItemPattern);
        if (!itemMatch) {
          break;
        }

        items.push(itemMatch[1]);
        lineIndex += 1;
      }

      blocks.push({ type: "unordered-list", items });
      continue;
    }

    const paragraphLines: string[] = [];

    while (lineIndex < lines.length) {
      const paragraphLine = lines[lineIndex].trim();
      if (
        !paragraphLine
        || headingPattern.test(paragraphLine)
        || orderedItemPattern.test(paragraphLine)
        || unorderedItemPattern.test(paragraphLine)
      ) {
        break;
      }

      paragraphLines.push(paragraphLine);
      lineIndex += 1;
    }

    if (paragraphLines.length > 0) {
      blocks.push({ type: "paragraph", content: paragraphLines.join(" ") });
    } else {
      lineIndex += 1;
    }
  }

  return blocks;
}

function renderInlineMarkdown(content: string) {
  return content.split(/(\*\*[^*]+\*\*)/g).map((part, index) => (
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
    ) : part
  ));
}

function FormattedAnswer({ content }: { content: string }) {
  return (
    <div className={styles.answerContent}>
      {parseAnswerBlocks(content).map((block, index) => {
        const key = `${block.type}-${index}`;

        if (block.type === "heading") {
          return <h3 className={styles.answerHeading} key={key}>{renderInlineMarkdown(block.content)}</h3>;
        }

        if (block.type === "ordered-list" || block.type === "unordered-list") {
          const List = block.type === "ordered-list" ? "ol" : "ul";

          return (
            <List className={styles.answerList} key={key}>
              {block.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>)}
            </List>
          );
        }

        return <p key={key}>{renderInlineMarkdown(block.content)}</p>;
      })}
    </div>
  );
}

function plainTextFromMarkdown(content: string) {
  return content
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^\s*(?:\d+[.)]|[-*])\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeMessageId(role: StoryChatMessage["role"]) {
  return `${role}-${crypto.randomUUID()}`;
}

export function StoryQuestionPanel({ storyId, isDemoData }: StoryQuestionPanelProps) {
  const dockInputId = useId();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const dialogInputRef = useRef<HTMLTextAreaElement>(null);
  const [messages, setMessages] = useState<StoryChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const latestAnswer = [...messages].reverse().find((message) => message.role === "assistant");

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
        <div className={styles.dockContent}>
          {latestAnswer ? (
            <section aria-live="polite" className={styles.answerPreview}>
              <div className={styles.previewHeader}>
                <p className={styles.previewEyebrow}>AI 回答</p>
                <button className={styles.previewExpandButton} onClick={openDialog} type="button">
                  完整对话
                </button>
              </div>
              <p className={styles.previewText}>{plainTextFromMarkdown(latestAnswer.content)}</p>
            </section>
          ) : null}
          <form className={styles.dockInner} onSubmit={submitQuestion}>
            <label className={styles.srOnly} htmlFor={dockInputId}>
              向 AI 提问
            </label>
            <input
              aria-describedby={error ? errorId : undefined}
              aria-invalid={Boolean(error)}
              className={styles.dockInput}
              disabled={isSubmitting}
              id={dockInputId}
              maxLength={500}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              placeholder="向 AI 追问这条新闻…"
              value={draft}
            />
            <button className={styles.compactSubmitButton} disabled={isSubmitting || !draft.trim()} type="submit">
              {isSubmitting ? "回答中" : "发送"}
            </button>
            <button className={styles.expandButton} disabled={isSubmitting} onClick={openDialog} type="button">
              展开
            </button>
          </form>
          {error ? (
            <p className={styles.dockError} id={errorId} role="alert">
              {error}
            </p>
          ) : null}
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
                      {message.role === "assistant" ? (
                        <FormattedAnswer content={message.content} />
                      ) : (
                        <p className={styles.messageText}>{message.content}</p>
                      )}
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
