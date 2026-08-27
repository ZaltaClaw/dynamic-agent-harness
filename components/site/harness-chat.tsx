"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ApprovalCard from "@/components/primitives/ApprovalCard";
import PromptBar from "@/components/primitives/PromptBar";
import StreamingText from "@/components/primitives/StreamingText";
import ThinkingState from "@/components/primitives/ThinkingState";
import ToolChips from "@/components/primitives/ToolChips";
import HarnessConfig from "@/components/site/harness-config";
import HarnessSidebar from "@/components/site/harness-sidebar";
import RunInspector from "@/components/site/run-inspector";
import {
  HARNESS_STREAM_ERROR_MESSAGE,
  HARNESS_STREAM_RECONNECT_MESSAGE,
  TRUEFORGE_EXPORT_GUIDANCE,
  approvalPresentation,
  createRunGenerationGuard,
  createSingleFlightGuard,
  deriveRunView,
  latestPendingApproval,
  mergeStreamEvent,
  parseApiError,
  parsePublicStreamEvent,
  parseRunEnvelope,
  runPaneForViewport,
  writeClipboardText,
  type PublicStreamEvent,
} from "@/lib/harness/client-view";
import { HarnessSpecSchema, type HarnessSpec } from "@/lib/harness/schema";

type RunStatus = "idle" | "running" | "waiting_for_approval" | "completed" | "failed";
type PaneMode = "none" | "config" | "run";

type ChatThread = {
  localId: string;
  title: string;
  prompt: string;
  runId: string | null;
  specSnapshot: HarnessSpec | null;
  status: RunStatus;
  events: PublicStreamEvent[];
  error: string | null;
};

const suggestions = [
  "Triage a production incident and write a reviewable response blueprint",
  "Research an emerging market with parallel specialists and cited synthesis",
  "Inspect a codebase, verify a change plan, and stop before the write boundary",
];

function makeThread(localId: string): ChatThread {
  return { localId, title: "New governed run", prompt: "", runId: null, specSnapshot: null, status: "idle", events: [], error: null };
}

function nextLocalId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `draft-${Date.now()}`;
}

function payloadString(payload: Record<string, unknown>, key: string, fallback: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function statusLabel(status: RunStatus) {
  if (status === "waiting_for_approval") return "Waiting for approval";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "running") return "Running";
  return "Ready";
}

function statusDot(status: RunStatus) {
  if (status === "completed") return "bg-green";
  if (status === "failed") return "bg-red";
  if (status === "waiting_for_approval") return "bg-orange";
  return "bg-accent";
}

export default function HarnessChat({ initialSpec }: { initialSpec: HarnessSpec }) {
  const [spec, setSpec] = useState(initialSpec);
  const [threads, setThreads] = useState<ChatThread[]>([makeThread("draft-1")]);
  const [activeId, setActiveId] = useState("draft-1");
  const [pane, setPane] = useState<PaneMode>("none");
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const connectionRef = useRef<EventSource | null>(null);
  const startAbortRef = useRef<AbortController | null>(null);
  const generationGuardRef = useRef(createRunGenerationGuard());
  const approvalGuardRef = useRef(createSingleFlightGuard());
  const reconcileInFlightRef = useRef(new Set<string>());
  const threadsRef = useRef(threads);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { threadsRef.current = threads; }, [threads]);

  const validation = useMemo(() => HarnessSpecSchema.safeParse(spec), [spec]);
  const validationMessage = validation.success ? null : validation.error.issues[0]?.message ?? "Invalid harness specification";
  const active = threads.find((thread) => thread.localId === activeId) ?? threads[0];
  const view = useMemo(() => deriveRunView(active?.events ?? []), [active?.events]);
  const pending = useMemo(() => latestPendingApproval(active?.events ?? []), [active?.events]);
  const approval = pending ? approvalPresentation(pending.payload) : null;
  const activeModelId = active?.specSnapshot?.model.id ?? spec.model.id;

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 1800);
  }, []);

  const updateThread = useCallback((localId: string, update: (thread: ChatThread) => ChatThread) => {
    setThreads((current) => current.map((thread) => thread.localId === localId ? update(thread) : thread));
  }, []);

  const closeConnection = useCallback(() => {
    connectionRef.current?.close();
    connectionRef.current = null;
  }, []);

  const reconcileRun = useCallback(async (localId: string, runId: string, generation: number) => {
    if (reconcileInFlightRef.current.has(runId)) return;
    reconcileInFlightRef.current.add(runId);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
      if (!response.ok || !generationGuardRef.current.isCurrent(generation)) return;
      const body: unknown = await response.json();
      const run = parseRunEnvelope(body);
      if (!run) return;
      updateThread(localId, (thread) => ({
        ...thread,
        status: run.status,
        error: run.status === "completed" || run.status === "failed" ? null : thread.error,
      }));
      if (run.status === "completed" || run.status === "failed") closeConnection();
    } catch {
      // EventSource owns transport retries; reconciliation is best effort.
    } finally {
      reconcileInFlightRef.current.delete(runId);
    }
  }, [closeConnection, updateThread]);

  const connect = useCallback((localId: string, runId: string, generation: number) => {
    closeConnection();
    const current = threadsRef.current.find((thread) => thread.localId === localId);
    const after = current?.events.at(-1)?.sequence ?? 0;
    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events?after=${after}`);
    connectionRef.current = source;

    source.onopen = () => {
      if (!generationGuardRef.current.isCurrent(generation)) return;
      updateThread(localId, (thread) => ({
        ...thread,
        error: thread.error === HARNESS_STREAM_RECONNECT_MESSAGE ? null : thread.error,
      }));
    };

    source.onmessage = (message) => {
      if (!generationGuardRef.current.isCurrent(generation)) return;
      const event = parsePublicStreamEvent(message.data, runId);
      if (!event) return;
      updateThread(localId, (thread) => {
        let status = thread.status;
        if (event.type === "run.started" || event.type === "approval.resolved") status = "running";
        if (event.type === "approval.required") status = "waiting_for_approval";
        if (event.type === "run.completed") status = "completed";
        if (event.type === "run.failed") status = "failed";
        return { ...thread, status, events: mergeStreamEvent(thread.events, event), error: event.type === "run.failed" ? payloadString(event.payload, "message", "The governed run failed.") : thread.error };
      });
      if (event.type === "run.completed" || event.type === "run.failed") closeConnection();
    };

    source.onerror = () => {
      if (!generationGuardRef.current.isCurrent(generation)) return;
      const current = threadsRef.current.find((thread) => thread.localId === localId);
      if (current && current.status !== "completed" && current.status !== "failed") {
        updateThread(localId, (thread) => ({ ...thread, error: HARNESS_STREAM_RECONNECT_MESSAGE }));
        void reconcileRun(localId, runId, generation);
      }
    };

    const onHarnessError = () => {
      if (!generationGuardRef.current.isCurrent(generation)) return;
      updateThread(localId, (thread) => ({ ...thread, status: "failed", error: HARNESS_STREAM_ERROR_MESSAGE }));
      closeConnection();
    };
    source.addEventListener("harness-error", onHarnessError);
  }, [closeConnection, reconcileRun, updateThread]);

  useEffect(() => {
    generationGuardRef.current.invalidate();
    closeConnection();
    if (active?.runId && active.status !== "completed" && active.status !== "failed") {
      const generation = generationGuardRef.current.begin();
      connect(active.localId, active.runId, generation);
    }
  }, [active?.localId, active?.runId, active?.status, closeConnection, connect]);

  useEffect(() => () => {
    startAbortRef.current?.abort();
    generationGuardRef.current.invalidate();
    closeConnection();
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, [closeConnection]);

  const createNewRun = useCallback(() => {
    const current = threadsRef.current.find((thread) => thread.localId === activeId);
    if (current && !current.prompt && !current.runId) {
      setPane("none");
      return current.localId;
    }
    const localId = nextLocalId();
    setThreads((items) => [makeThread(localId), ...items]);
    setActiveId(localId);
    setPane("none");
    return localId;
  }, [activeId]);

  const startRun = async (text: string) => {
    if (!validation.success) {
      setPane("config");
      showToast(validationMessage ?? "Fix the harness spec first");
      return;
    }

    const current = threadsRef.current.find((thread) => thread.localId === activeId);
    const localId = current && !current.runId && !current.prompt ? current.localId : createNewRun();
    const title = text.length > 44 ? `${text.slice(0, 44).trim()}…` : text;
    updateThread(localId, (thread) => ({ ...thread, title, prompt: text, specSnapshot: validation.data, status: "running", events: [], error: null }));
    setActiveId(localId);
    setPane(runPaneForViewport(window.matchMedia("(min-width: 1024px)").matches));

    startAbortRef.current?.abort();
    const startController = new AbortController();
    startAbortRef.current = startController;
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec: validation.data, prompt: text }),
        signal: startController.signal,
      });
      const body: unknown = await response.json();
      const run = parseRunEnvelope(body);
      if (!response.ok || !run) throw new Error(parseApiError(body) ?? "Unable to start the governed run");
      updateThread(localId, (thread) => ({ ...thread, runId: run.id, status: run.status, error: null }));
    } catch (error) {
      if (startController.signal.aborted) return;
      updateThread(localId, (thread) => ({ ...thread, status: "failed", error: error instanceof Error ? error.message : "Unable to start the governed run" }));
    } finally {
      if (startAbortRef.current === startController) startAbortRef.current = null;
    }
  };

  const resolveApproval = async (decision: "allow" | "deny") => {
    if (!active?.runId || !pending) return;
    const approvalId = payloadString(pending.payload, "approvalId", "");
    if (!approvalId || !approvalGuardRef.current.tryStart()) return;
    setApprovalSubmitting(true);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(active.runId)}/approvals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId, decision }),
      });
      const body: unknown = await response.json();
      const run = parseRunEnvelope(body);
      if (!response.ok || !run) throw new Error(parseApiError(body) ?? "Approval could not be resolved");
      updateThread(active.localId, (thread) => ({ ...thread, status: run.status, error: null }));
    } catch (error) {
      updateThread(active.localId, (thread) => ({ ...thread, error: error instanceof Error ? error.message : "Approval could not be resolved" }));
    } finally {
      approvalGuardRef.current.finish();
      setApprovalSubmitting(false);
    }
  };

  const exportPayload = useMemo(() => ({ spec, trueforge: TRUEFORGE_EXPORT_GUIDANCE }), [spec]);
  const copySpec = async () => showToast(await writeClipboardText(JSON.stringify(exportPayload, null, 2)) ? "Harness spec copied" : "Clipboard unavailable");
  const exportSpec = () => {
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${spec.slug || "harness"}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast("Harness spec exported");
  };
  const copyRunId = async () => showToast(active?.runId && await writeClipboardText(active.runId) ? "Run ID copied" : "Clipboard unavailable");
  const copyArtifact = async () => showToast(view.artifactPath && await writeClipboardText(view.artifactPath) ? "Artifact path copied" : "Clipboard unavailable");

  const terminal = active?.status === "completed" || active?.status === "failed";
  const running = active?.status === "running" || active?.status === "waiting_for_approval";
  const recentRuns = threads.filter((thread) => thread.prompt).map((thread) => ({ id: thread.localId, label: thread.title }));

  return (
    <main className="flex h-dvh min-h-0 gap-2.5 overflow-hidden bg-canvas p-2.5 lg:pl-0">
      <HarnessSidebar
        activeTitle={active?.title ?? null}
        recents={recentRuns}
        configActive={pane === "config"}
        onConfigure={() => setPane((current) => current === "config" ? "none" : "config")}
        onNewRun={createNewRun}
        onPick={(id) => { setActiveId(id); setPane("run"); }}
      />

      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-window bg-page shadow-hairline">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-2.5">
          <div className="flex min-w-0 flex-1 items-center">
            <button type="button" aria-label="Start new run" onClick={createNewRun} className="mr-1 flex size-11 shrink-0 items-center justify-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink lg:hidden lg:size-8"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 20l4.2-1 10.7-10.7a2 2 0 0 0-2.8-2.8L5.4 16.2zM14.7 6.9l2.8 2.8"/></svg></button>
            <div className="flex h-7 min-w-0 max-w-[320px] items-center gap-2 rounded-[7px] bg-hover px-2.5 text-[12.5px] text-ink">
              <span className={`size-1.5 shrink-0 rounded-full ${statusDot(active?.status ?? "idle")}`} style={active?.status === "running" ? { animation: "pulse 1.3s ease-in-out infinite" } : undefined} />
              <span className="truncate">{active?.title ?? "New governed run"}</span>
            </div>
          </div>
          {active?.runId && <span role="status" aria-live="polite" aria-atomic="true" className="hidden h-6 items-center gap-1.5 rounded-full bg-inset px-2 text-[10px] font-medium text-ink-2 shadow-hairline sm:inline-flex"><span className={`size-1.5 rounded-full ${statusDot(active.status)}`} />{statusLabel(active.status)}</span>}
          {active?.runId && <button type="button" onClick={() => setPane((current) => current === "run" ? "none" : "run")} className="h-11 rounded-[7px] px-2 text-[11.5px] font-medium text-ink-2 hover:bg-hover hover:text-ink lg:h-7">Inspector</button>}
          <button type="button" aria-label="Configure harness" onClick={() => setPane((current) => current === "config" ? "none" : "config")} className="flex size-11 items-center justify-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink lg:size-7"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/></svg></button>
        </header>

        {!active?.prompt ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-center px-5 py-16 sm:px-8">
              <div className="text-[13px] font-medium text-ink-3">Dynamic Agent Harness</div>
              <h1 className="mt-1.5 text-[28px] font-[470] tracking-[-0.035em] text-ink sm:text-[32px]">What should the harness do?</h1>
              <p className="mt-2 max-w-[590px] text-[13px] leading-relaxed text-ink-3">Start a real replayable run. The backend will fan out isolated workers, invoke governed tools, pause at write boundaries, and persist an artifact.</p>
              <div className="mt-7"><PromptBar tall modelLabel={activeModelId} disabled={!validation.success} onConfigure={() => setPane("config")} onSend={startRun} /></div>
              {!validation.success && <button type="button" onClick={() => setPane("config")} className="mt-2 text-left text-[11px] text-red hover:underline">Fix the harness spec: {validationMessage}</button>}
              <div className="mt-6 text-[11px] font-medium text-ink-3">Try a governed workflow</div>
              <div className="mt-2 grid gap-1">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => startRun(suggestion)} disabled={!validation.success} className="group flex min-h-10 items-center gap-3 rounded-control px-2.5 text-left text-[13px] text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"><span className="size-1.5 shrink-0 rounded-full bg-line-strong transition-colors group-hover:bg-accent"/><span>{suggestion}</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="ml-auto shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button>
                ))}
              </div>
              <div className="mt-8 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[9.5px] text-ink-3"><span>localhost-first</span><span>runtime-enforced approvals</span><span>JSONL event replay</span><span>vendor-neutral spec</span></div>
            </div>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
              <div className="mx-auto w-full max-w-[720px] px-5 py-8 sm:px-8 sm:py-11">
                <div className="flex justify-end"><div className="max-w-[82%] rounded-[10px] bg-inset px-3.5 py-2.5 text-[13px] leading-relaxed text-ink shadow-hairline">{active.prompt}</div></div>
                <article className="mt-8 flex flex-col gap-5">
                  <ThinkingState rows={view.thinkingRows} working={running} label="Running isolated workers" doneLabel={terminal ? statusLabel(active.status) : "Governed reasoning complete"} />
                  <ToolChips rows={view.toolRows} />
                  {pending && approval && (
                    <ApprovalCard
                      title={approval.title}
                      description={approval.copy}
                      tool={payloadString(pending.payload, "tool", "requested action")}
                      risk={payloadString(pending.payload, "risk", "unspecified")}
                      submitting={approvalSubmitting}
                      onAllow={() => resolveApproval("allow")}
                      onDeny={() => resolveApproval("deny")}
                    />
                  )}
                  {view.message && <StreamingText text={view.message} animate fill />}
                  {active.error && active.error !== HARNESS_STREAM_RECONNECT_MESSAGE && <div role="alert" className="max-w-[630px] rounded-card bg-red-tint px-3 py-2.5 text-[12px] leading-relaxed text-red shadow-hairline">{active.error}</div>}
                  {active.error === HARNESS_STREAM_RECONNECT_MESSAGE && <div role="status" className="text-[11px] text-ink-3">{active.error}</div>}
                  {view.artifactPath && <button type="button" onClick={copyArtifact} className="flex w-fit items-center gap-2 rounded-control bg-green-tint px-2.5 py-2 text-[11.5px] font-medium text-green shadow-hairline hover:brightness-95"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 2H6a2 2 0 0 0-2 2v16h16V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>Artifact · {view.artifactPath}</button>}
                </article>
              </div>
            </div>
            <div className={`shrink-0 border-t border-line bg-page/95 px-4 py-3 backdrop-blur-sm sm:px-7 ${running ? "hidden lg:block" : ""}`}>
              <div className="mx-auto max-w-[720px]">
                <PromptBar tall={false} modelLabel={activeModelId} disabled={running} busy={running} placeholder={terminal ? "Start another governed run…" : "Run failed — start a new governed run…"} onConfigure={() => setPane("config")} onSend={startRun} />
                <div className="mt-1.5 text-center text-[9.5px] text-ink-3">Each prompt starts a separate durable run · approvals are enforced outside the model</div>
              </div>
            </div>
          </>
        )}
      </section>

      {pane !== "none" && <button type="button" aria-label="Close side panel" onClick={() => setPane("none")} className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] lg:hidden" />}
      {pane !== "none" && (
        <aside aria-label={pane === "config" ? "Harness configuration" : "Run inspector"} className="fixed inset-2 z-50 flex min-h-0 overflow-hidden rounded-window bg-page shadow-overlay lg:static lg:inset-auto lg:z-auto lg:w-[360px] lg:shrink-0 lg:shadow-hairline">
          {pane === "config" ? (
            <HarnessConfig spec={spec} valid={validation.success} validationMessage={validationMessage} onChange={setSpec} onClose={() => setPane("none")} onCopy={copySpec} onExport={exportSpec} />
          ) : (
            <RunInspector runId={active?.runId ?? null} status={active?.status ?? "idle"} events={active?.events ?? []} error={active?.error ?? null} artifactPath={view.artifactPath} onClose={() => setPane("none")} onCopyRunId={copyRunId} onCopyArtifact={copyArtifact} onExport={exportSpec} />
          )}
        </aside>
      )}

      {toast && <div role="status" className="pointer-events-none fixed right-4 bottom-4 z-[80] rounded-[9px] bg-surface px-3 py-2.5 text-[11px] font-medium text-ink shadow-overlay" style={{ animation: "toast-in 250ms cubic-bezier(0.23,1,0.32,1) both" }}>{toast}</div>}
    </main>
  );
}
