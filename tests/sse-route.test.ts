import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunEvent } from "@/lib/harness/store";

const storeMocks = vi.hoisted(() => ({
  getRun: vi.fn(),
  listEvents: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("@/lib/harness/services", () => ({
  getHarnessServices: () => ({ store: storeMocks }),
}));

import { GET as getEvents } from "@/app/api/runs/[runId]/events/route";

const validRunId = "550e8400-e29b-41d4-a716-446655440000";

function routeContext(runId = validRunId) {
  return { params: Promise.resolve({ runId }) };
}

function event(sequence: number, type = "run.status_changed"): RunEvent {
  return {
    id: `${validRunId}:${sequence}`,
    runId: validRunId,
    sequence,
    type,
    timestamp: "2026-08-27T00:00:00.000Z",
    data: { sequence },
  };
}

let storedEvents: RunEvent[];
let subscriber: ((event: RunEvent) => void) | undefined;
let unsubscribe: ReturnType<typeof vi.fn>;

async function readWithin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  milliseconds = 50,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

beforeEach(() => {
  storedEvents = [event(1, "run.started"), event(2, "run.completed")];
  subscriber = undefined;
  unsubscribe = vi.fn();
  storeMocks.getRun.mockReset().mockResolvedValue({ id: validRunId, status: "completed" });
  storeMocks.listEvents.mockReset().mockImplementation(
    async (_runId: string, after = 0) => storedEvents.filter((item) => item.sequence > after),
  );
  storeMocks.subscribe.mockReset().mockImplementation(
    (_runId: string, listener: (item: RunEvent) => void) => {
      subscriber = listener;
      return unsubscribe;
    },
  );
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET /api/runs/:runId/events request boundary", () => {
  it("returns a stable 403 before store access for a non-loopback request URL", async () => {
    const response = await getEvents(
      new Request(`http://example.test/api/runs/${validRunId}/events`),
      routeContext(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden request" });
    expect(storeMocks.getRun).not.toHaveBeenCalled();
    expect(storeMocks.listEvents).not.toHaveBeenCalled();
    expect(storeMocks.subscribe).not.toHaveBeenCalled();
  });

  it("returns a stable 403 before store access for a cross-origin request", async () => {
    const response = await getEvents(
      new Request(`http://localhost:3110/api/runs/${validRunId}/events`, {
        headers: { origin: "https://localhost:3110" },
      }),
      routeContext(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden request" });
    expect(storeMocks.getRun).not.toHaveBeenCalled();
    expect(storeMocks.listEvents).not.toHaveBeenCalled();
    expect(storeMocks.subscribe).not.toHaveBeenCalled();
  });

  it("returns 400 before store access for an invalid run id", async () => {
    const response = await getEvents(
      new Request("http://localhost/api/runs/bad/events"),
      routeContext("../bad"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid run id" });
    expect(storeMocks.getRun).not.toHaveBeenCalled();
  });

  it.each([
    "12junk",
    "1.5",
    "-1",
    "+1",
    " 1",
    "01",
    "9007199254740992",
    "",
  ])("returns 400 for malformed after cursor %j", async (cursor) => {
    const response = await getEvents(
      new Request(`http://localhost/api/runs/${validRunId}/events?after=${encodeURIComponent(cursor)}`),
      routeContext(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid event cursor" });
    expect(storeMocks.getRun).not.toHaveBeenCalled();
  });

  it("gives Last-Event-ID precedence and rejects it when malformed", async () => {
    const response = await getEvents(
      new Request(`http://localhost/api/runs/${validRunId}/events?after=1`, {
        headers: { "last-event-id": "2junk" },
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid event cursor" });
  });

  it("rejects a cursor beyond the latest persisted sequence", async () => {
    const response = await getEvents(
      new Request(`http://localhost/api/runs/${validRunId}/events?after=3`),
      routeContext(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Event cursor is ahead of this run" });
    expect(storeMocks.subscribe).not.toHaveBeenCalled();
  });

  it.each(["completed", "failed"])(
    "closes an empty replay when the run is already %s",
    async (status) => {
      const terminalType = status === "completed" ? "run.completed" : "run.failed";
      storedEvents = [event(1, "run.started"), event(2, terminalType)];
      storeMocks.getRun.mockResolvedValue({ id: validRunId, status });
      const response = await getEvents(
        new Request(`http://localhost/api/runs/${validRunId}/events?after=2`),
        routeContext(),
      );
      const reader = response.body!.getReader();

      const result = await readWithin(reader);
      if (result === "timeout") await reader.cancel();

      expect(result).toEqual({ done: true, value: undefined });
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    },
  );

  it("closes without subscribing when the request signal is already aborted", async () => {
    storedEvents = [event(1, "run.started")];
    storeMocks.getRun.mockResolvedValue({ id: validRunId, status: "running" });
    const abortController = new AbortController();
    abortController.abort();

    const response = await getEvents(
      new Request(`http://localhost/api/runs/${validRunId}/events?after=1`, {
        signal: abortController.signal,
      }),
      routeContext(),
    );
    const reader = response.body!.getReader();

    const result = await readWithin(reader);
    if (result === "timeout") await reader.cancel();

    expect(result).toEqual({ done: true, value: undefined });
    expect(storeMocks.subscribe).not.toHaveBeenCalled();
  });

  it("detaches the subscription and ignores late events after reader cancellation", async () => {
    storedEvents = [event(1, "run.started")];
    storeMocks.getRun.mockResolvedValue({ id: validRunId, status: "running" });
    const response = await getEvents(
      new Request(`http://localhost/api/runs/${validRunId}/events?after=1`),
      routeContext(),
    );
    const reader = response.body!.getReader();
    await vi.waitFor(() => expect(storeMocks.listEvents).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await reader.cancel();

    expect(subscriber).toBeTypeOf("function");
    expect(() => subscriber!(event(2))).not.toThrow();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("detaches the subscription and closes after a live request abort", async () => {
    storedEvents = [event(1, "run.started")];
    storeMocks.getRun.mockResolvedValue({ id: validRunId, status: "running" });
    const abortController = new AbortController();
    const response = await getEvents(
      new Request(`http://localhost/api/runs/${validRunId}/events?after=1`, {
        signal: abortController.signal,
      }),
      routeContext(),
    );
    const reader = response.body!.getReader();
    await vi.waitFor(() => expect(storeMocks.listEvents).toHaveBeenCalledTimes(2));

    abortController.abort();

    await expect(readWithin(reader)).resolves.toEqual({ done: true, value: undefined });
    expect(() => subscriber!(event(2))).not.toThrow();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("returns a stable redacted harness-error frame when subscription fails", async () => {
    storedEvents = [event(1, "run.started")];
    storeMocks.getRun.mockResolvedValue({ id: validRunId, status: "running" });
    storeMocks.subscribe.mockImplementationOnce(() => {
      throw new Error("ENOENT: /Users/private/.data/events/run.jsonl");
    });

    const response = await getEvents(
      new Request(`http://localhost/api/runs/${validRunId}/events?after=1`),
      routeContext(),
    );

    await expect(response.text()).resolves.toBe(
      'event: harness-error\ndata: {"error":"Event stream failed"}\n\n',
    );
  });

  it("returns a stable redacted harness-error frame when replay fails", async () => {
    storedEvents = [event(1, "run.started")];
    storeMocks.getRun.mockResolvedValue({ id: validRunId, status: "running" });
    storeMocks.listEvents
      .mockResolvedValueOnce(storedEvents)
      .mockRejectedValueOnce(new Error("EACCES: /private/event-store/run.jsonl"));

    const response = await getEvents(
      new Request(`http://localhost/api/runs/${validRunId}/events?after=1`),
      routeContext(),
    );

    await expect(response.text()).resolves.toBe(
      'event: harness-error\ndata: {"error":"Event stream failed"}\n\n',
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
