"use client";

import { useState } from "react";
import type { ToolRow } from "@/lib/harness/client-view";

export type ToolChipsProps = {
  rows?: ToolRow[];
};

function StatusIcon({ status }: { status: ToolRow["status"] }) {
  if (status === "completed") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  if (status === "denied") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    );
  }
  return <span className="size-3 rounded-full border-[1.5px] border-line-strong border-t-accent" style={{ animation: "spin 700ms linear infinite" }} />;
}

export default function ToolChips({ rows = [] }: ToolChipsProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const completed = rows.filter((row) => row.status === "completed").length;

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (rows.length === 0) return null;

  return (
    <div className="w-full max-w-[630px] pb-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-control px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover-2"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-200" style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="tabular-nums">{rows.length} tool {rows.length === 1 ? "call" : "calls"} · {completed} complete</span>
      </button>

      {open && (
        <div className="grid transition-[grid-template-rows,opacity] duration-300" style={{ gridTemplateRows: "1fr", opacity: 1 }}>
          <div className="overflow-hidden">
            <div className="mt-1.5 flex flex-col gap-1">
              {rows.map((row, index) => {
                const rowOpen = expanded.has(row.id);
                return (
                  <div key={row.id} style={{ animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${index * 50}ms both` }}>
                    <button
                      type="button"
                      aria-expanded={rowOpen}
                      onClick={() => toggle(row.id)}
                      className="group/row -mx-[3px] flex min-h-8 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-control px-[3px] text-left transition-colors duration-100 hover:bg-hover-2"
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center"><StatusIcon status={row.status} /></span>
                      <span className="min-w-0 shrink truncate font-mono text-[12px] font-medium text-ink">{row.name}</span>
                      <span className="inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-chip bg-field px-1.5 text-[11.5px] text-ink-2 shadow-hairline">
                        {row.detail}
                      </span>
                      <span className={`shrink-0 rounded-chip px-1.5 py-0.5 font-mono text-[9.5px] ${row.status === "denied" ? "bg-red-tint text-red" : "bg-inset text-ink-3"}`}>{row.risk}</span>
                    </button>
                    {rowOpen && (
                      <div className="grid transition-[grid-template-rows,opacity] duration-250" style={{ gridTemplateRows: "1fr", opacity: 1 }}>
                        <div className="overflow-hidden">
                          <p className="mt-0.5 mb-1 ml-2 border-l border-line py-1 pl-3.5 text-[11.5px] leading-relaxed text-ink-2">{row.detail}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
