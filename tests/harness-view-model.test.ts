import { describe, expect, it } from "vitest";
import {
  deriveRunView,
  latestPendingApproval,
  mergeStreamEvent,
  parseApiError,
  parseRunEnvelope,
  runPaneForViewport,
  type PublicStreamEvent,
} from "@/lib/harness/client-view";

function event(
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
): PublicStreamEvent {
  return {
    id: `event-${sequence}`,
    runId: "run-1",
    sequence,
    type,
    timestamp: `2026-08-27T15:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload,
  };
}

describe("live harness view model", () => {
  it("deduplicates replayed events and keeps sequence order", () => {
    const first = event(2, "tool.started", { tool: "catalog.discover" });
    const earlier = event(1, "run.started", { summary: "Started" });

    const merged = mergeStreamEvent(
      mergeStreamEvent(mergeStreamEvent([], first), earlier),
      first,
    );

    expect(merged.map((item) => item.sequence)).toEqual([1, 2]);
  });

  it("maps real tool and worker events into primitive-ready rows", () => {
    const view = deriveRunView([
      event(1, "run.started", { summary: "Started the governed harness workflow." }),
      event(2, "subagent.started", { subagentId: "scout", role: "capability scout", summary: "Started scout." }),
      event(3, "tool.started", { subagentId: "scout", tool: "catalog.discover", risk: "read", summary: "Invoked catalog." }),
      event(4, "tool.completed", { subagentId: "scout", tool: "catalog.discover", risk: "read", summary: "Confirmed inventory." }),
      event(5, "subagent.completed", { subagentId: "scout", role: "capability scout", summary: "Scout complete." }),
    ]);

    expect(view.thinkingRows).toEqual([
      { id: "scout", label: "capability scout", detail: "Scout complete.", status: "completed" },
    ]);
    expect(view.toolRows).toEqual([
      { id: "scout:catalog.discover", name: "catalog.discover", detail: "Confirmed inventory.", risk: "read", status: "completed" },
    ]);
  });

  it("exposes only unresolved runtime approvals", () => {
    const required = event(8, "approval.required", {
      approvalId: "approval-1",
      tool: "blueprint.write",
      risk: "write",
      summary: "Approval is required.",
    });
    expect(latestPendingApproval([required])?.payload.approvalId).toBe("approval-1");

    const resolved = event(9, "approval.resolved", {
      approvalId: "approval-1",
      decision: "allow",
    });
    expect(latestPendingApproval([required, resolved])).toBeNull();
  });

  it("keeps new mobile runs chat-first while opening the desktop inspector", () => {
    expect(runPaneForViewport(false)).toBe("none");
    expect(runPaneForViewport(true)).toBe("run");
  });

  it("unwraps the API data envelope and rejects malformed run records", () => {
    expect(parseRunEnvelope({ data: { id: "run-1", status: "running", pendingApprovalId: null } })).toEqual({
      id: "run-1",
      status: "running",
      pendingApprovalId: null,
    });
    expect(parseRunEnvelope({ id: "run-1", status: "running" })).toBeNull();
    expect(parseRunEnvelope({ data: { id: "", status: "running" } })).toBeNull();
    expect(parseRunEnvelope({ data: { id: "run-1", status: "created" } })).toBeNull();
  });

  it("reads stable API errors without trusting malformed payloads", () => {
    expect(parseApiError({ error: "Approval conflict" })).toBe("Approval conflict");
    expect(parseApiError({ error: "   " })).toBeNull();
    expect(parseApiError({ data: { error: "nested" } })).toBeNull();
  });

  it("prefers the completed assistant message and exposes the artifact", () => {
    const view = deriveRunView([
      event(10, "message.delta", { delta: "Partial" }),
      event(11, "message.completed", { content: "The governed harness blueprint was approved and written." }),
      event(12, "run.completed", { artifactPath: "artifacts/run-1.json", summary: "Done" }),
    ]);

    expect(view.message).toBe("The governed harness blueprint was approved and written.");
    expect(view.artifactPath).toBe("artifacts/run-1.json");
    expect(view.completed).toBe(true);
  });
});
