"use client";

import { useEffect, useState } from "react";

export type StreamingTextProps = {
  text: string;
  animate?: boolean;
  fill?: boolean;
  loop?: boolean;
  onDone?: () => void;
};

function StreamingSequence({ text, animate, fill, onDone }: Required<Pick<StreamingTextProps, "text" | "animate" | "fill">> & Pick<StreamingTextProps, "onDone">) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const [count, setCount] = useState(animate ? 0 : words.length);
  const [copied, setCopied] = useState(false);
  const done = count >= words.length;

  useEffect(() => {
    if (!animate || done) {
      onDone?.();
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setCount((current) => reduce ? words.length : current + 1), reduce ? 0 : 32);
    return () => clearTimeout(timer);
  }, [animate, count, done, onDone, words.length]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={fill ? "w-full" : "w-full max-w-95"}>
      <p className="text-[13.5px] leading-[1.68] text-ink-2">
        {words.slice(0, count).map((word, index) => (
          <span key={`${index}-${word}`} className="inline" style={{ animation: "stream-in 180ms cubic-bezier(0.23,1,0.32,1) both" }}>
            {word}{" "}
          </span>
        ))}
        {!done && <span className="ml-0.5 inline-block h-3 w-0.5 translate-y-0.5 rounded-full bg-ink" style={{ animation: "fade-in 150ms ease-out both" }} />}
      </p>
      <div className="mt-2 flex min-h-6 items-center transition-opacity duration-300" style={{ opacity: done ? 1 : 0, pointerEvents: done ? "auto" : "none" }}>
        <button
          type="button"
          aria-label="Copy response"
          onClick={copy}
          className="flex h-6 items-center gap-1.5 rounded-[6px] px-1.5 text-[11.5px] text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink-2"
        >
          {copied ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function StreamingText({ text, animate = true, fill = true, onDone }: StreamingTextProps) {
  if (!text.trim()) return null;
  return <StreamingSequence key={`${text}:${animate}`} text={text} animate={animate} fill={fill} onDone={onDone} />;
}
