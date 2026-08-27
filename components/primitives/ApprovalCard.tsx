"use client";

import { useEffect, useRef } from "react";

export type ApprovalCardProps = {
  title: string;
  description: string;
  tool: string;
  risk: string;
  submitting?: boolean;
  onAllow: () => void;
  onDeny: () => void;
};

export default function ApprovalCard({
  title,
  description,
  tool,
  risk,
  submitting = false,
  onAllow,
  onDeny,
}: ApprovalCardProps) {
  const approvalHeadingRef = useRef<HTMLHeadingElement>(null);
  const approvalCardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      approvalHeadingRef.current?.focus({ preventScroll: true });
      approvalCardRef.current?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section
      ref={approvalCardRef}
      role="region"
      aria-labelledby="runtime-approval-title"
      className="w-full max-w-[430px] overflow-hidden rounded-card bg-surface shadow-card"
      style={{ animation: "fade-up 380ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      <div className="primitive-card-pad">
        <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.08em] text-orange uppercase">
          <span className="flex size-5 items-center justify-center rounded-[6px] bg-orange-tint">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3l7 3v5c0 4.5-2.8 8-7 10-4.2-2-7-5.5-7-10V6z" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
          </span>
          Runtime checkpoint
        </div>
        <h3 ref={approvalHeadingRef} id="runtime-approval-title" tabIndex={-1} className="mt-3 text-[14px] font-medium text-ink outline-none">{title}</h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{description}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="inline-flex h-6 items-center rounded-chip bg-inset px-2 font-mono text-[10.5px] text-ink-2 shadow-hairline">{tool}</span>
          <span className="inline-flex h-6 items-center rounded-chip bg-orange-tint px-2 font-mono text-[10.5px] text-orange">{risk} risk</span>
        </div>
      </div>
      <div className="primitive-card-footer flex items-center justify-end gap-1.5 border-t border-line">
        <button
          type="button"
          disabled={submitting}
          onClick={onDeny}
          className="inline-flex h-8 items-center justify-center rounded-control px-3 text-[12px] font-medium text-red transition-colors duration-100 hover:bg-red-tint disabled:cursor-not-allowed disabled:opacity-45"
        >
          Deny
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={onAllow}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-control bg-ink px-3 text-[12px] font-medium text-surface shadow-btn transition-[opacity,transform] duration-150 enabled:hover:opacity-85 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {submitting ? (
            <><span className="size-3 rounded-full border border-surface/40 border-t-surface" style={{ animation: "spin 700ms linear infinite" }} />Resolving…</>
          ) : (
            <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>Allow once</>
          )}
        </button>
      </div>
    </section>
  );
}
