import { isPublicIdentifier, localhostRequestBoundary } from "@/app/api/runs/http";
import { getHarnessServices } from "@/lib/harness/services";
import { formatSseError, formatSseEvent, formatSseHeartbeat } from "@/lib/harness/sse";
import type { RunEvent } from "@/lib/harness/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ runId: string }> };

const encoder = new TextEncoder();

function cursorFrom(request: Request): number | null {
  const url = new URL(request.url);
  const header = request.headers.get("last-event-id");
  const raw = header !== null
    ? header
    : (url.searchParams.has("after") ? url.searchParams.get("after") ?? "" : "0");
  if (!/^(?:0|[1-9][0-9]*)$/.test(raw)) return null;
  const cursor = Number(raw);
  return Number.isSafeInteger(cursor) ? cursor : null;
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(request: Request, context: Context) {
  const boundaryError = localhostRequestBoundary(request);
  if (boundaryError) return boundaryError;

  let runId: string;
  try {
    ({ runId } = await context.params);
  } catch (error) {
    console.error("Failed to open event stream", error);
    return jsonError("Event stream could not be opened", 500);
  }

  if (!isPublicIdentifier(runId)) {
    return jsonError("Invalid run id", 400);
  }

  const after = cursorFrom(request);
  if (after === null) {
    return jsonError("Invalid event cursor", 400);
  }

  let store: ReturnType<typeof getHarnessServices>["store"];
  let run: Awaited<ReturnType<typeof store.getRun>>;
  try {
    ({ store } = getHarnessServices());
    run = await store.getRun(runId);
    if (!run) {
      return jsonError("Run not found", 404);
    }
    const snapshot = await store.listEvents(runId, 0);
    const latestSequence = snapshot.at(-1)?.sequence ?? 0;
    if (after > latestSequence) {
      return jsonError("Event cursor is ahead of this run", 400);
    }
  } catch (error) {
    console.error("Failed to open event stream", error);
    return jsonError("Event stream could not be opened", 500);
  }

  let cancelStream: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let replaying = true;
      let cursor = after;
      const buffered: RunEvent[] = [];
      let unsubscribe: () => void = () => {};
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let listeningForAbort = false;

      const cleanup = () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
        const detach = unsubscribe;
        unsubscribe = () => {};
        try {
          detach();
        } catch {
          // Cleanup must remain idempotent even if an adapter's unsubscribe fails.
        }
        if (listeningForAbort) {
          request.signal.removeEventListener("abort", abort);
          listeningForAbort = false;
        }
      };
      const finish = (closeController: boolean) => {
        if (closed) return;
        closed = true;
        cleanup();
        if (!closeController) return;
        try {
          controller.close();
        } catch {
          // Cancellation may close the controller before an abort or terminal event wins the race.
        }
      };
      const abort = () => finish(true);
      const enqueue = (frame: string) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(frame));
          return true;
        } catch {
          finish(false);
          return false;
        }
      };
      const emit = (event: RunEvent) => {
        if (closed || event.sequence <= cursor) return;
        cursor = event.sequence;
        if (!enqueue(formatSseEvent(event))) return;
        if (event.type === "run.completed" || event.type === "run.failed") finish(true);
      };

      cancelStream = () => finish(false);
      if (request.signal.aborted) {
        finish(true);
        return;
      }
      request.signal.addEventListener("abort", abort, { once: true });
      listeningForAbort = true;

      try {
        const detach = store.subscribe(runId, (event) => {
          if (closed) return;
          if (replaying) buffered.push(event);
          else emit(event);
        });
        if (closed) {
          detach();
          return;
        }
        unsubscribe = detach;
        heartbeat = setInterval(() => {
          enqueue(formatSseHeartbeat());
        }, 15_000);

        const replay = await store.listEvents(runId, after);
        for (const event of replay) emit(event);
        replaying = false;
        buffered.sort((a, b) => a.sequence - b.sequence).forEach(emit);
        if (!closed && (run.status === "completed" || run.status === "failed")) finish(true);
      } catch (error) {
        if (!closed) {
          enqueue(formatSseError(error));
          finish(true);
        }
      }
    },
    cancel() {
      cancelStream?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
