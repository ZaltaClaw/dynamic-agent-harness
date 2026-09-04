export type PublicStreamEvent = {
  id: string;
  runId: string;
  sequence: number;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
};

export type ThinkingRow = {
  id: string;
  label: string;
  detail: string;
  status: "running" | "completed";
};

export type ToolRow = {
  id: string;
  name: string;
  detail: string;
  risk: string;
  status: "running" | "completed" | "denied";
};

export type RunView = {
  thinkingRows: ThinkingRow[];
  toolRows: ToolRow[];
  message: string;
  artifactPath: string | null;
  completed: boolean;
};

export const HARNESS_STREAM_ERROR_MESSAGE = "Event stream failed. Start a new run to retry.";
export const HARNESS_STREAM_RECONNECT_MESSAGE = "Stream reconnecting. Persisted events will replay automatically.";
export const TRUEFORGE_EXPORT_GUIDANCE = "Call toTrueForgeManifest from lib/harness/compiler.ts to generate a TrueForge manifest.";

export function runPaneForViewport(isDesktop: boolean): "run" | "none" {
  void isDesktop;
  return "none";
}

type ClipboardWriter = { writeText: (text: string) => Promise<void> };

export type ClientRunStatus = "running" | "waiting_for_approval" | "completed" | "failed";

export type CompletionOutcome = {
  tone: "success" | "neutral";
  label: "Blueprint ready" | "Run complete";
};

export function completionOutcome(
  status: ClientRunStatus | "idle",
  artifactPath: string | null,
): CompletionOutcome | null {
  if (status !== "completed") return null;
  return artifactPath
    ? { tone: "success", label: "Blueprint ready" }
    : { tone: "neutral", label: "Run complete" };
}

export type ClientRun = {
  id: string;
  status: ClientRunStatus;
  pendingApprovalId?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isClientRunStatus(value: unknown): value is ClientRunStatus {
  return value === "running"
    || value === "waiting_for_approval"
    || value === "completed"
    || value === "failed";
}

export function parseRunEnvelope(value: unknown): ClientRun | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const run = value.data;
  if (typeof run.id !== "string" || run.id.length === 0 || !isClientRunStatus(run.status)) return null;
  if (
    run.pendingApprovalId !== undefined
    && run.pendingApprovalId !== null
    && typeof run.pendingApprovalId !== "string"
  ) return null;
  return {
    id: run.id,
    status: run.status,
    ...(run.pendingApprovalId !== undefined ? { pendingApprovalId: run.pendingApprovalId } : {}),
  };
}

export function parseApiError(value: unknown): string | null {
  return isRecord(value) ? nonEmptyString(value.error) : null;
}

export function parsePublicStreamEvent(data: string, expectedRunId: string): PublicStreamEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(value) || !isRecord(value.payload)) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  if (value.runId !== expectedRunId) return null;
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) return null;
  if (typeof value.type !== "string" || value.type.length === 0) return null;
  if (typeof value.timestamp !== "string" || value.timestamp.length === 0) return null;
  return value as PublicStreamEvent;
}

export function createRunGenerationGuard() {
  let current = 0;
  return {
    begin() {
      current += 1;
      return current;
    },
    isCurrent(generation: number) {
      return generation === current;
    },
    invalidate() {
      current += 1;
    },
  };
}

export function createSingleFlightGuard() {
  let active = false;
  return {
    tryStart() {
      if (active) return false;
      active = true;
      return true;
    },
    finish() {
      active = false;
    },
  };
}

export async function writeClipboardText(
  text: string,
  clipboard: ClipboardWriter | undefined = typeof navigator === "undefined" ? undefined : navigator.clipboard,
): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function approvalPresentation(payload: Record<string, unknown>) {
  const tool = nonEmptyString(payload.tool) ?? "requested action";
  const risk = nonEmptyString(payload.risk) ?? "unspecified";
  const summary = nonEmptyString(payload.summary) ?? `${tool} is waiting for approval.`;
  return {
    title: `Allow ${tool}?`,
    copy: `${summary} Risk: ${risk}. This checkpoint is enforced by the runtime, outside the model.`,
  };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function mergeStreamEvent(
  events: PublicStreamEvent[],
  incoming: PublicStreamEvent,
): PublicStreamEvent[] {
  if (events.some((event) => event.id === incoming.id)) return events;
  return [...events, incoming].sort((left, right) => left.sequence - right.sequence);
}

export function latestPendingApproval(
  events: PublicStreamEvent[],
): PublicStreamEvent | null {
  const resolved = new Set(
    events
      .filter((event) => event.type === "approval.resolved")
      .map((event) => nonEmptyString(event.payload.approvalId))
      .filter((id): id is string => id !== null),
  );

  return [...events]
    .reverse()
    .find((event) => {
      if (event.type !== "approval.required") return false;
      const approvalId = nonEmptyString(event.payload.approvalId);
      return approvalId !== null && !resolved.has(approvalId);
    }) ?? null;
}

export function deriveRunView(events: PublicStreamEvent[]): RunView {
  const thinking = new Map<string, ThinkingRow>();
  const tools = new Map<string, ToolRow>();

  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.type === "subagent.started" || event.type === "subagent.completed") {
      const id = nonEmptyString(event.payload.subagentId);
      if (id) {
        thinking.set(id, {
          id,
          label: nonEmptyString(event.payload.role) ?? id,
          detail: nonEmptyString(event.payload.summary) ?? "Isolated branch checkpoint recorded.",
          status: event.type === "subagent.completed" ? "completed" : "running",
        });
      }
    }

    if (["tool.started", "tool.completed", "tool.denied"].includes(event.type)) {
      const name = nonEmptyString(event.payload.tool);
      if (name) {
        const scope = nonEmptyString(event.payload.subagentId) ?? "primary";
        const id = `${scope}:${name}`;
        tools.set(id, {
          id,
          name,
          detail: nonEmptyString(event.payload.summary) ?? "Tool checkpoint recorded.",
          risk: nonEmptyString(event.payload.risk) ?? "unspecified",
          status: event.type === "tool.completed"
            ? "completed"
            : event.type === "tool.denied"
              ? "denied"
              : "running",
        });
      }
    }
  }

  const completedMessage = [...events]
    .reverse()
    .find((event) => event.type === "message.completed");
  const message = nonEmptyString(completedMessage?.payload.content)
    ?? events
      .filter((event) => event.type === "message.delta")
      .map((event) => nonEmptyString(event.payload.delta) ?? "")
      .join("");

  const artifactPath = [...events]
    .reverse()
    .map((event) => nonEmptyString(event.payload.artifactPath))
    .find((value): value is string => value !== null) ?? null;

  return {
    thinkingRows: [...thinking.values()],
    toolRows: [...tools.values()],
    message,
    artifactPath,
    completed: events.some((event) => event.type === "run.completed"),
  };
}
