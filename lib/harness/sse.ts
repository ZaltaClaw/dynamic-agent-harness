import type { RunEvent } from "@/lib/harness/store";

export function toPublicEvent(event: RunEvent) {
  return {
    id: event.id,
    runId: event.runId,
    sequence: event.sequence,
    type: event.type,
    timestamp: event.timestamp,
    payload: event.data,
  };
}

export function formatSseEvent(event: RunEvent) {
  return `id: ${event.sequence}\ndata: ${JSON.stringify(toPublicEvent(event))}\n\n`;
}

export function formatSseHeartbeat() {
  return ": keep-alive\n\n";
}

export const SSE_APPLICATION_ERROR_EVENT = "harness-error";

export function formatSseError(error?: unknown) {
  void error;
  return `event: ${SSE_APPLICATION_ERROR_EVENT}\ndata: ${JSON.stringify({ error: "Event stream failed" })}\n\n`;
}
