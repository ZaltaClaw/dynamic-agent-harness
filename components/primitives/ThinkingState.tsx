"use client";

import { useState } from "react";
import type { ThinkingRow } from "@/lib/harness/client-view";

export type ThinkingStateProps = {
  rows?: ThinkingRow[];
  working?: boolean;
  label?: string;
  doneLabel?: string;
  variant?: string;
  onSettled?: () => void;
};

export default function ThinkingState({
  rows = [],
  working = false,
  label = "Running isolated work",
  doneLabel = "Governed reasoning complete",
}: ThinkingStateProps) {
  const [expanded, setExpanded] = useState(true);
  const completed = rows.filter((row) => row.status === "completed").length;
  const statusLabel = working
    ? rows.length > 0
      ? `${label} · ${completed}/${rows.length}`
      : "Starting governed run"
    : doneLabel;

  return (
    <div className="flex w-full max-w-[630px] flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 hover:bg-hover-2"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill={working ? "var(--ink-2)" : "var(--ink-3)"} aria-hidden>
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        <span role="status" className="contents">
          <span
            className={working
              ? "bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
              : "text-[13px] font-medium whitespace-nowrap text-ink-2"}
            style={working ? {
              backgroundImage: "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
              backgroundSize: "200% 100%",
              animation: "shimmer-text 1.4s linear infinite",
            } : undefined}
          >
            {statusLabel}
          </span>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-transform duration-300"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: expanded && rows.length > 0 ? "1fr" : "0fr",
          opacity: expanded && rows.length > 0 ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.23,1,0.32,1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="relative mt-1 ml-[5px] border-l border-line py-1 pl-4">
            {rows.map((row, index) => (
              <div
                key={row.id}
                className="flex min-h-8 items-start gap-2 rounded-[6px] px-1.5 py-1"
                style={{ animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${index * 55}ms both` }}
              >
                {row.status === "completed" ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : (
                  <span className="mt-1 size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-accent" style={{ animation: "spin 700ms linear infinite" }} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-ink">{row.label}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-3">{row.detail}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
