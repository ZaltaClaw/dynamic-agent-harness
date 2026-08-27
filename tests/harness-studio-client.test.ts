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
} from "@/components/studio/harness-studio";

const studioSource = readFileSync(resolve(import.meta.dirname, "../components/studio/harness-studio.tsx"), "utf8");
const runtimeRailSource = studioSource.slice(
  studioSource.indexOf("function RuntimeRail"),
  studioSource.indexOf("export default function HarnessStudio"),
);

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

    expect(runtimeRailSource).toContain("if (!approvalGuardRef.current.tryStart()) return");
    expect(runtimeRailSource).toContain("approvalGuardRef.current.finish()");
    expect(runtimeRailSource).toContain("finally {");
    expect(runtimeRailSource).toContain("disabled={approvalSubmitting}");
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
    expect(runtimeRailSource).toContain("parsePublicStreamEvent(message.data, runId)");
    expect(runtimeRailSource).not.toContain("JSON.parse(message.data)");
  });

  it("wires generation checks into start responses and stream callbacks", () => {
    const generationChecks = runtimeRailSource.match(/generationGuardRef\.current\.isCurrent\(generation\)/g) ?? [];

    expect(runtimeRailSource).toContain("const generation = generationGuardRef.current.begin()");
    expect(runtimeRailSource).toContain("const connect = (runId: string, generation: number)");
    expect(runtimeRailSource).toContain("generationGuardRef.current.invalidate()");
    expect(generationChecks.length).toBeGreaterThanOrEqual(5);
  });

  it("aborts an obsolete start request on a new start or unmount", () => {
    expect(runtimeRailSource).toContain("const startAbortRef = useRef<AbortController | null>(null)");
    expect(runtimeRailSource.match(/startAbortRef\.current\?\.abort\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(runtimeRailSource).toContain("signal: startController.signal");
    expect(runtimeRailSource).toContain("startAbortRef.current === startController");
  });

  it("reads current run status when EventSource reports a transport error", () => {
    expect(runtimeRailSource).toContain('const statusRef = useRef<RunStatus>("idle")');
    expect(runtimeRailSource).toContain('statusRef.current !== "completed" && statusRef.current !== "failed"');
    expect(runtimeRailSource).not.toContain('if (status !== "completed")');
  });

  it("clears only the reconnect notice when EventSource reopens", () => {
    expect(HARNESS_STREAM_RECONNECT_MESSAGE).toBe("Stream reconnecting. Persisted events will replay automatically.");
    expect(runtimeRailSource).toContain("source.onopen = () =>");
    expect(runtimeRailSource).toContain("current === HARNESS_STREAM_RECONNECT_MESSAGE ? null : current");
    expect(runtimeRailSource).toContain("source.onopen = null");
  });

  it("handles harness-error as a stable terminal stream failure", () => {
    expect(HARNESS_STREAM_ERROR_MESSAGE).toBe("Event stream failed. Start a new run to retry.");
    expect(runtimeRailSource).toContain('source.addEventListener("harness-error", onHarnessError)');
    expect(runtimeRailSource).toContain('source.removeEventListener("harness-error", onHarnessError)');
    expect(runtimeRailSource).toContain("setError(HARNESS_STREAM_ERROR_MESSAGE)");
    expect(runtimeRailSource).toContain("closeConnection()");
  });

  it("cleans up the EventSource when a run reaches a terminal event", () => {
    expect(runtimeRailSource).toContain('event.type === "run.completed") { updateStatus("completed"); closeConnection(); }');
    expect(runtimeRailSource).toContain('event.type === "run.failed") { updateStatus("failed"); closeConnection(); }');
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
    expect(runtimeRailSource).toContain("const approval = pending ? approvalPresentation(pending.payload) : null");
    expect(runtimeRailSource).toContain("{approval.title}");
    expect(runtimeRailSource).toContain("{approval.copy}");
    expect(runtimeRailSource).not.toContain("Allow blueprint.write?");
  });

  it("provides truthful TrueForge export guidance", () => {
    expect(TRUEFORGE_EXPORT_GUIDANCE).toContain("toTrueForgeManifest");
    expect(TRUEFORGE_EXPORT_GUIDANCE).toContain("lib/harness/compiler.ts");
    expect(TRUEFORGE_EXPORT_GUIDANCE).not.toContain("npm run export:trueforge");
    expect(studioSource).toContain("trueforge: TRUEFORGE_EXPORT_GUIDANCE");
    expect(studioSource).not.toContain("npm run export:trueforge");
  });

  it("handles clipboard write failures and wires the safe helper into copy actions", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));

    await expect(writeClipboardText("run-id", { writeText })).resolves.toBe(false);
    expect(writeText).toHaveBeenCalledWith("run-id");
    expect(runtimeRailSource).toContain("await writeClipboardText(run.id)");
    expect(runtimeRailSource).not.toContain("navigator.clipboard.writeText(run.id)");
    expect(studioSource).toContain("await writeClipboardText(JSON.stringify(exportPayload, null, 2))");
  });
});
