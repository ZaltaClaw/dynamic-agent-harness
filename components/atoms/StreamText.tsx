"use client";

import { useEffect, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * STREAM TEXT — reusable streaming primitive
 * Reveals characters quickly (fast, like a real token stream);
 * the leading edge resolves out of a soft blur, and the caret
 * stays solid while streaming, then blinks once the text
 * settles. Inherits typography from its context, so it drops
 * into any text surface (Selection Actions, chat, etc.).
 * ───────────────────────────────────────────────────────── */

type StreamTextProps = {
  text: string;
  /** characters revealed per tick — higher is faster */
  charsPerTick?: number;
  /** interval between reveals, ms */
  tickMs?: number;
  /** how many trailing characters carry the soft blur edge */
  blurTail?: number;
  /** render the caret (solid while streaming, blinks once idle) */
  caret?: boolean;
  className?: string;
  /** fires each tick — useful for re-anchoring UI to reflowing text */
  onProgress?: () => void;
  /** fires once the full string is shown */
  onDone?: () => void;
};

function StreamSequence({
  text,
  charsPerTick = 2,
  tickMs = 9,
  blurTail = 6,
  caret = true,
  className,
  onProgress,
  onDone,
}: StreamTextProps) {
  const [count, setCount] = useState(0);
  const onProgressRef = useRef(onProgress);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onProgressRef.current = onProgress;
    onDoneRef.current = onDone;
  }, [onProgress, onDone]);

  useEffect(() => {
    let index = 0;
    const id = setInterval(() => {
      index = Math.min(index + charsPerTick, text.length);
      setCount(index);
      onProgressRef.current?.();
      if (index >= text.length) {
        clearInterval(id);
        onDoneRef.current?.();
      }
    }, tickMs);
    return () => clearInterval(id);
  }, [text, charsPerTick, tickMs]);

  const streaming = count < text.length;
  const shown = text.slice(0, count);
  const split = streaming ? Math.max(0, shown.length - blurTail) : shown.length;

  return (
    <span className={className}>
      {shown.slice(0, split)}
      {split < shown.length && <span className="stream-tail">{shown.slice(split)}</span>}
      {caret && <span aria-hidden className={`stream-caret${streaming ? " is-streaming" : ""}`} />}
    </span>
  );
}

export function StreamText(props: StreamTextProps) {
  return <StreamSequence key={`${props.text}:${props.charsPerTick ?? 2}:${props.tickMs ?? 9}`} {...props} />;
}
