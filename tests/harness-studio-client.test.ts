import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  approvalPresentation,
  createRunGenerationGuard,
  createSingleFlightGuard,
  HARNESS_STREAM_ERROR_MESSAGE,
  HARNESS_STREAM_RECONNECT_MESSAGE,
  parsePublicStreamEvent,
  TRUEFORGE_EXPORT_GUIDANCE,
  writeClipboardText,
} from "@/lib/harness/client-view";

const shellSource = readFileSync(resolve(import.meta.dirname, "../components/site/harness-chat.tsx"), "utf8");
const approvalSource = readFileSync(resolve(import.meta.dirname, "../components/primitives/ApprovalCard.tsx"), "utf8");

const validEvent = {
  id: "run-1:2",
  runId: "run-1",
  sequence: 2,
  type: "tool.completed",
  timestamp: "2026-08-27T00:00:00.000Z",
  payload: { tool: "context.audit" },
};

describe("harness studio client boundaries", () => {
  it("invalidates an older start token when a newer run begins", () => {
    const generations = createRunGenerationGuard();
    const first = generations.begin();
    const second = generations.begin();

    expect(generations.isCurrent(first)).toBe(false);
    expect(generations.isCurrent(second)).toBe(true);
  });

  it("invalidates the current token when the client lifecycle ends", () => {
    const generations = createRunGenerationGuard();
    const current = generations.begin();

    generations.invalidate();

    expect(generations.isCurrent(current)).toBe(false);
  });

  it("allows only one in-flight approval operation and releases in finally", () => {
    const guard = createSingleFlightGuard();

    expect(guard.tryStart()).toBe(true);
    expect(guard.tryStart()).toBe(false);
    guard.finish();
    expect(guard.tryStart()).toBe(true);

    expect(shellSource).toContain("if (!approvalId || !approvalGuardRef.current.tryStart()) return");
    expect(shellSource).toContain("approvalGuardRef.current.finish()");
    expect(shellSource).toContain("finally {");
    expect(shellSource).toContain("submitting={approvalSubmitting}");
    expect(approvalSource.match(/disabled=\{submitting\}/g)?.length).toBe(2);
  });

  it("accepts only a valid public stream event for the active run", () => {
    expect(parsePublicStreamEvent(JSON.stringify(validEvent), "run-1")).toEqual(validEvent);

    for (const value of [
      "not json",
      "null",
      JSON.stringify({ ...validEvent, runId: "another-run" }),
      JSON.stringify({ ...validEvent, sequence: Number.MAX_SAFE_INTEGER + 1 }),
      JSON.stringify({ ...validEvent, type: "" }),
      JSON.stringify({ ...validEvent, payload: [] }),
    ]) {
      expect(parsePublicStreamEvent(value, "run-1")).toBeNull();
    }
  });

  it("routes EventSource messages through the public event parser", () => {
    expect(shellSource).toContain("parsePublicStreamEvent(message.data, runId)");
    expect(shellSource).not.toContain("JSON.parse(message.data)");
  });

  it("wires generation checks into stream lifecycle callbacks", () => {
    const generationChecks = shellSource.match(/generationGuardRef\.current\.isCurrent\(generation\)/g) ?? [];

    expect(shellSource).toContain("const generation = generationGuardRef.current.begin()");
    expect(shellSource).toContain("const connect = useCallback((localId: string, runId: string, generation: number)");
    expect(shellSource).toContain("generationGuardRef.current.invalidate()");
    expect(generationChecks.length).toBeGreaterThanOrEqual(4);
  });

  it("aborts an obsolete start request on a new start or unmount", () => {
    expect(shellSource).toContain("const startAbortRef = useRef<AbortController | null>(null)");
    expect(shellSource.match(/startAbortRef\.current\?\.abort\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(shellSource).toContain("signal: startController.signal");
    expect(shellSource).toContain("startAbortRef.current === startController");
  });

  it("reads the current thread status when EventSource reports a transport error", () => {
    expect(shellSource).toContain("const threadsRef = useRef(threads)");
    expect(shellSource).toContain("const current = threadsRef.current.find");
    expect(shellSource).toContain('current.status !== "completed" && current.status !== "failed"');
  });

  it("clears only the reconnect notice when EventSource reopens", () => {
    expect(HARNESS_STREAM_RECONNECT_MESSAGE).toBe("Stream reconnecting. Persisted events will replay automatically.");
    expect(shellSource).toContain("source.onopen = () =>");
    expect(shellSource).toContain("thread.error === HARNESS_STREAM_RECONNECT_MESSAGE ? null : thread.error");
  });

  it("handles harness-error as a stable terminal stream failure", () => {
    expect(HARNESS_STREAM_ERROR_MESSAGE).toBe("Event stream failed. Start a new run to retry.");
    expect(shellSource).toContain('source.addEventListener("harness-error", onHarnessError)');
    expect(shellSource).toContain('status: "failed", error: HARNESS_STREAM_ERROR_MESSAGE');
    expect(shellSource).toContain("closeConnection()");
  });

  it("cleans up the EventSource when a run reaches a terminal event", () => {
    expect(shellSource).toContain('if (event.type === "run.completed") status = "completed"');
    expect(shellSource).toContain('if (event.type === "run.failed") status = "failed"');
    expect(shellSource).toContain('if (event.type === "run.completed" || event.type === "run.failed") closeConnection()');
  });

  it("derives approval presentation from the pending event payload", () => {
    expect(approvalPresentation({
      tool: "repository.delete",
      risk: "delete",
      summary: "Remove the generated scratch branch.",
    })).toEqual({
      title: "Allow repository.delete?",
      copy: "Remove the generated scratch branch. Risk: delete. This checkpoint is enforced by the runtime, outside the model.",
    });
    expect(shellSource).toContain("const approval = pending ? approvalPresentation(pending.payload) : null");
    expect(shellSource).toContain("{approval.title}");
    expect(shellSource).toContain("{approval.copy}");
    expect(shellSource).not.toContain("Allow blueprint.write?");
  });

  it("provides truthful TrueForge export guidance", () => {
    expect(TRUEFORGE_EXPORT_GUIDANCE).toContain("toTrueForgeManifest");
    expect(TRUEFORGE_EXPORT_GUIDANCE).toContain("lib/harness/compiler.ts");
    expect(TRUEFORGE_EXPORT_GUIDANCE).not.toContain("npm run export:trueforge");
    expect(shellSource).toContain("trueforge: TRUEFORGE_EXPORT_GUIDANCE");
    expect(shellSource).not.toContain("npm run export:trueforge");
  });

  it("handles clipboard write failures and wires the safe helper into copy actions", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));

    await expect(writeClipboardText("run-id", { writeText })).resolves.toBe(false);
    expect(writeText).toHaveBeenCalledWith("run-id");
    expect(shellSource).toContain("await writeClipboardText(active.runId)");
    expect(shellSource).not.toContain("navigator.clipboard.writeText(active.runId)");
    expect(shellSource).toContain("await writeClipboardText(JSON.stringify(exportPayload, null, 2))");
  });

  it("reopens a run after its last rendered sequence instead of replaying from zero", () => {
    expect(shellSource).toContain("const after = current?.events.at(-1)?.sequence ?? 0");
    expect(shellSource).toContain("?after=${after}");
  });

  it("reconciles stream transport failures against the authoritative run record", () => {
    expect(shellSource).toContain("const reconcileRun = useCallback");
    expect(shellSource).toContain("fetch(`/api/runs/${encodeURIComponent(runId)}`");
    expect(shellSource).toContain("void reconcileRun(localId, runId, generation)");
    expect(shellSource).toContain('run.status === "completed" || run.status === "failed"');
  });

  it("freezes the submitted harness spec on each run thread", () => {
    expect(shellSource).toContain("specSnapshot: HarnessSpec | null");
    expect(shellSource).toContain("specSnapshot: validation.data");
    expect(shellSource).toContain("active?.specSnapshot?.model.id ?? spec.model.id");
  });
});
