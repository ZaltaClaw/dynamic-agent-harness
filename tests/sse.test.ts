import { describe, expect, it } from "vitest";
import { formatSseError, formatSseEvent, formatSseHeartbeat } from "@/lib/harness/sse";
import type { RunEvent } from "@/lib/harness/store";

describe("SSE formatting", () => {
  it("formats a heartbeat as a valid SSE comment frame", () => {
    expect(formatSseHeartbeat()).toBe(": keep-alive\n\n");
  });

  it("uses harness-error with a stable public payload that redacts internal details", () => {
    expect(formatSseError(new Error("ENOENT: /Users/private/.data/events/run.jsonl"))).toBe(
      'event: harness-error\ndata: {"error":"Event stream failed"}\n\n',
    );
  });

  it("maps internal event data to the public payload contract", () => {
    const event: RunEvent = {
      id: "run-1:2",
      runId: "run-1",
      sequence: 2,
      type: "tool.completed",
      timestamp: "2026-08-27T00:00:00.000Z",
      data: { tool: "context.audit" },
    };

    const frame = formatSseEvent(event);

    expect(frame).toContain("id: 2\n");
    expect(frame).toContain('"payload":{"tool":"context.audit"}');
    expect(frame.endsWith("\n\n")).toBe(true);
  });
});
