"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import type {
  StoryChatAnswer,
  StoryChatMessage,
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
const TYPEWRITER_INTERVAL_MS = 14;

type StoryQuestionStreamEvent =
  | { type: "delta"; content: string }
  | { type: "done"; answer: StoryChatAnswer }
  | { type: "error"; message: string };

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

function ExpandIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="m3 8 6-6M21 8l-6-6M3 16l6 6M21 16l-6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="m9 3-6 6M15 3l6 6M9 21l-6-6M15 21l6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M3 3v5h5M21 3v5h-5M3 21v-5h5M21 21v-5h-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="m21 3-7.5 18-3.8-7.7L3 9.5 21 3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="m9.6 13.3 4-4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
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
  const previewTextRef = useRef<HTMLParagraphElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  const pendingContentRef = useRef("");
  const visibleContentRef = useRef("");
  const completedAnswerRef = useRef<StoryChatAnswer | null>(null);
  const activeAnswerIdRef = useRef<string | null>(null);
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

  const revealNextCharacter = () => {
    const answerId = activeAnswerIdRef.current;
    if (!answerId) {
      return;
    }

    const nextCharacter = pendingContentRef.current.slice(0, 1);
    if (nextCharacter) {
      pendingContentRef.current = pendingContentRef.current.slice(1);
      visibleContentRef.current += nextCharacter;
      setMessages((currentMessages) => currentMessages.map((message) => (
        message.id === answerId ? { ...message, content: visibleContentRef.current } : message
      )));
      typingTimerRef.current = window.setTimeout(revealNextCharacter, TYPEWRITER_INTERVAL_MS);
      return;
    }

    const completedAnswer = completedAnswerRef.current;
    if (!completedAnswer) {
      typingTimerRef.current = null;
      return;
    }

    setMessages((currentMessages) => currentMessages.map((message) => (
      message.id === answerId
        ? { ...message, content: completedAnswer.answer, citations: completedAnswer.citations }
        : message
    )));
    typingTimerRef.current = null;
    pendingContentRef.current = "";
    visibleContentRef.current = "";
    completedAnswerRef.current = null;
    activeAnswerIdRef.current = null;
    setIsSubmitting(false);
  };

  const enqueueStreamContent = (content: string) => {
    pendingContentRef.current += content;

    if (typingTimerRef.current === null) {
      revealNextCharacter();
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

  useEffect(() => () => {
    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const previewText = previewTextRef.current;

    if (previewText) {
      previewText.scrollTop = previewText.scrollHeight;
    }
  }, [latestAnswer?.content]);

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
    const answerMessageId = makeMessageId("assistant");
    const optimisticAnswer: StoryChatMessage = {
      id: answerMessageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    };

    const recentTurns = messages.slice(-8).map((message) => ({
      role: message.role,
      content: message.content,
    }));

    activeAnswerIdRef.current = answerMessageId;
    pendingContentRef.current = "";
    visibleContentRef.current = "";
    completedAnswerRef.current = null;
    setMessages((currentMessages) => [...currentMessages, optimisticMessage, optimisticAnswer]);
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
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? "暂时无法整理回答，请稍后重试。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let completedAnswer: StoryChatAnswer | null = null;

      const processEvent = (line: string) => {
        if (!line) {
          return;
        }

        const event = JSON.parse(line) as StoryQuestionStreamEvent;
        if (event.type === "delta") {
          enqueueStreamContent(event.content);
          return;
        }

        if (event.type === "done") {
          completedAnswer = event.answer;
          return;
        }

        throw new Error(event.message);
      };

      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";

        for (const line of lines) {
          processEvent(line);
        }

        if (done) {
          processEvent(pending);
          break;
        }
      }

      if (!completedAnswer) {
        throw new Error("AI 服务未返回完整回答，请稍后重试。");
      }

      completedAnswerRef.current = completedAnswer;
      if (typingTimerRef.current === null) {
        revealNextCharacter();
      }
    } catch (caughtError) {
      if (typingTimerRef.current !== null) {
        window.clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }

      pendingContentRef.current = "";
      visibleContentRef.current = "";
      completedAnswerRef.current = null;
      activeAnswerIdRef.current = null;
      setMessages((currentMessages) => currentMessages.filter((message) => (
        message.id !== optimisticMessage.id && message.id !== answerMessageId
      )));
      setDraft(normalizedQuestion);
      setError(caughtError instanceof Error ? caughtError.message : "暂时无法整理回答，请稍后重试。");
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
              <p className={styles.previewText} ref={previewTextRef}>
                {latestAnswer.content ? plainTextFromMarkdown(latestAnswer.content) : "正在生成回答…"}
              </p>
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
            <button aria-label={isSubmitting ? "AI 正在回答" : "发送问题"} className={`${styles.compactSubmitButton} ${styles.iconButton}`} disabled={isSubmitting || !draft.trim()} title={isSubmitting ? "AI 正在回答" : "发送问题"} type="submit">
              <SendIcon />
            </button>
            <button aria-label="展开完整对话" className={`${styles.expandButton} ${styles.iconButton}`} disabled={isSubmitting} onClick={openDialog} title="展开完整对话" type="button">
              <ExpandIcon />
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
              <button aria-label="收起完整对话" className={`${styles.collapseButton} ${styles.iconButton}`} disabled={isSubmitting} onClick={closeDialog} title="收起完整对话" type="button">
                <CollapseIcon />
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
                <button aria-label={isSubmitting ? "AI 正在回答" : "发送问题"} className={`${styles.submitButton} ${styles.iconButton}`} disabled={isSubmitting || !draft.trim()} title={isSubmitting ? "AI 正在回答" : "发送问题"} type="submit">
                  <SendIcon />
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
