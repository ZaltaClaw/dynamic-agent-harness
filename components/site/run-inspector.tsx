"use client";

import type { PublicStreamEvent } from "@/lib/harness/client-view";

type RunStatus = "idle" | "running" | "waiting_for_approval" | "completed" | "failed";

type RunInspectorProps = {
  runId: string | null;
  status: RunStatus;
  events: PublicStreamEvent[];
  error: string | null;
  artifactPath: string | null;
  onClose: () => void;
  onCopyRunId: () => void;
  onCopyArtifact: () => void;
  onExport: () => void;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function summary(event: PublicStreamEvent): string {
  return stringValue(event.payload.summary)
    ?? stringValue(event.payload.message)
    ?? stringValue(event.payload.content)
    ?? stringValue(event.payload.tool)
    ?? "Runtime checkpoint recorded.";
}

function tone(type: string) {
  if (type.includes("approval")) return "bg-orange";
  if (type.includes("completed") || type.includes("artifact")) return "bg-green";
  if (type.includes("failed") || type.includes("denied")) return "bg-red";
  if (type.includes("tool") || type.includes("started")) return "bg-accent";
  return "bg-ink-3";
}

export default function RunInspector({ runId, status, events, error, artifactPath, onClose, onCopyRunId, onCopyArtifact, onExport }: RunInspectorProps) {
  const workers = new Set(events.filter((event) => event.type === "subagent.completed").map((event) => stringValue(event.payload.subagentId)).filter(Boolean)).size;
  const tools = events.filter((event) => event.type === "tool.completed").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3 pl-4">
        <div><div className="text-[13px] font-semibold text-ink">Run inspector</div><div className="font-mono text-[9.5px] text-ink-3">{runId ?? "Not started"}</div></div>
        <button type="button" aria-label="Close run inspector" onClick={onClose} className="flex size-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold text-ink">Replayable execution</span>
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-inset px-2 text-[10px] font-medium text-ink-2 shadow-hairline"><span className={`size-1.5 rounded-full ${status === "completed" ? "bg-green" : status === "failed" ? "bg-red" : status === "waiting_for_approval" ? "bg-orange" : "bg-accent"}`} style={status === "running" ? { animation: "pulse 1.3s ease-in-out infinite" } : undefined}/>{status.replaceAll("_", " ")}</span>
        </div>

        <div className="mt-4 grid grid-cols-3 border-y border-line">
          {[[events.length, "events"], [workers, "workers"], [tools, "tools"]].map(([value, label], index) => <div key={String(label)} className={`py-3 ${index < 2 ? "border-r border-line" : ""} ${index > 0 ? "pl-3" : ""}`}><div className="font-mono text-[16px] font-semibold text-ink">{value}</div><div className="mt-1 text-[8.5px] tracking-[0.06em] text-ink-3 uppercase">{label}</div></div>)}
        </div>

        {error && <div role="alert" className="mt-4 rounded-card bg-red-tint p-3 text-[11.5px] leading-relaxed text-red shadow-hairline">{error}</div>}

        {artifactPath && (
          <button type="button" onClick={onCopyArtifact} className="mt-4 flex w-full items-center gap-2 rounded-card bg-green-tint p-3 text-left shadow-hairline transition-colors hover:brightness-95">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-control bg-green text-white"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 2H6a2 2 0 0 0-2 2v16h16V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg></span>
            <span className="min-w-0"><span className="block text-[11.5px] font-medium text-green">Artifact written</span><span className="mt-0.5 block truncate font-mono text-[9.5px] text-green/80">{artifactPath}</span></span>
          </button>
        )}

        <div className="mt-5 text-[10px] font-semibold tracking-[0.07em] text-ink-3 uppercase">Event trace</div>
        {events.length === 0 ? (
          <div className="mt-2 rounded-card border border-dashed border-line-strong px-4 py-8 text-center text-[11px] leading-relaxed text-ink-3">Events will appear here as the runtime persists them.</div>
        ) : (
          <div className="relative mt-2 pl-4 before:absolute before:top-3 before:bottom-3 before:left-[3px] before:w-px before:bg-line">
            {events.map((event) => (
              <div key={event.id} className="relative border-b border-line py-2.5 last:border-b-0">
                <span className={`absolute top-4 -left-[15px] size-1.5 rounded-full ring-2 ring-page ${tone(event.type)}`} />
                <div className="flex items-start justify-between gap-2"><span className="min-w-0 truncate font-mono text-[10px] font-medium text-ink">{event.type}</span><span className="shrink-0 font-mono text-[8.5px] text-ink-3">#{String(event.sequence).padStart(2, "0")}</span></div>
                <p className="mt-1 text-[10.5px] leading-relaxed text-ink-2">{summary(event)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="flex shrink-0 gap-1.5 border-t border-line p-3">
        <button type="button" disabled={!runId} onClick={onCopyRunId} className="h-8 rounded-control px-2.5 text-[11px] font-medium text-ink-2 hover:bg-hover disabled:opacity-35">Copy run ID</button>
        <button type="button" onClick={onExport} className="ml-auto h-8 rounded-control bg-ink px-3 text-[11px] font-medium text-surface shadow-btn hover:opacity-85">Export spec</button>
      </footer>
    </div>
  );
}
