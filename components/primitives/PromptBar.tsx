"use client";

import { useLayoutEffect, useRef, useState } from "react";

function Icon({ children, size = 15 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export type PromptBarProps = {
  variant?: string;
  demo?: boolean;
  tall?: boolean;
  placeholder?: string;
  modelLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  onConfigure?: () => void;
  onSend?: (text: string) => void;
};

export default function PromptBar({
  variant = "Rounded",
  tall = true,
  placeholder = "Ask the harness to do something…",
  modelLabel = "deterministic runbook",
  disabled = false,
  busy = false,
  onConfigure,
  onSend,
}: PromptBarProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pill = variant === "Pill";
  const canSend = !disabled && !busy && draft.trim().length > 0;

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    const minimum = tall ? 56 : 28;
    input.style.height = `${Math.min(Math.max(input.scrollHeight, minimum), 132)}px`;
    input.style.overflowY = input.scrollHeight > 132 ? "auto" : "hidden";
  }, [draft, tall]);

  const send = () => {
    const value = draft.trim();
    if (!canSend || !value) return;
    onSend?.(value);
    setDraft("");
  };

  return (
    <div
      data-promptbar
      className={`relative w-full border border-line-strong bg-surface p-2 shadow-card transition-[border-color,box-shadow] duration-150 focus-within:border-accent ${pill ? "rounded-full" : "rounded-[10px]"}`}
    >
      <textarea
        ref={inputRef}
        aria-label="Run prompt"
        value={draft}
        disabled={disabled || busy}
        rows={1}
        placeholder={busy ? "The governed run is in progress…" : placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }}
        className="block w-full resize-none bg-transparent px-2 py-1.5 text-[13.5px] leading-[1.55] text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed disabled:opacity-60"
      />

      <div className="mt-1 flex min-w-0 items-center justify-between gap-2 px-0.5">
        <div className="flex min-w-0 items-center gap-1">
          {onConfigure && (
            <button
              type="button"
              aria-label="Configure harness"
              onClick={onConfigure}
              className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink"
            >
              <Icon><path d="M12 5v14M5 12h14" /></Icon>
            </button>
          )}
          <span className="flex h-7 min-w-0 items-center gap-1.5 rounded-[7px] px-2 text-[11.5px] text-ink-2">
            <span className="size-1.5 shrink-0 rounded-full bg-accent" />
            <span className="truncate">{modelLabel}</span>
          </span>
        </div>

        <button
          type="button"
          aria-label={busy ? "Run in progress" : "Start governed run"}
          disabled={!canSend}
          onClick={send}
          className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-ink text-surface shadow-btn transition-[background-color,transform,opacity] duration-150 enabled:hover:opacity-85 enabled:active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-30"
        >
          {busy ? (
            <span className="size-3 rounded-full border border-surface/40 border-t-surface" style={{ animation: "spin 700ms linear infinite" }} />
          ) : (
            <Icon size={14}><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" /></Icon>
          )}
        </button>
      </div>
    </div>
  );
}
