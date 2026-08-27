import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DynamicHarnessRuntime } from "@/lib/harness/runtime";
import { FileRunStore, type EventData, type RunEvent, type RunEventListener, type RunStore, type RunUpdate, type RunUpdatePrecondition } from "@/lib/harness/store";
import { defaultHarnessSpec, type HarnessSpec } from "@/lib/harness/schema";

const roots: string[] = [];

async function temporaryStore() {
  const root = await mkdtemp(join(tmpdir(), "dynamic-harness-runtime-hardening-"));
  roots.push(root);
  return new FileRunStore({ root });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function readOnlySpec(overrides: Partial<HarnessSpec["runtime"]["subagents"]> = {}): HarnessSpec {
  return {
    ...defaultHarnessSpec,
    tools: defaultHarnessSpec.tools.filter((tool) => tool.risk === "read").slice(0, 1),
    runtime: {
      ...defaultHarnessSpec.runtime,
      subagents: { enabled: false, maxParallel: 1, ...overrides },
    },
  };
}

class FailOnceEventStore implements RunStore {
  private failed = false;

  constructor(
    private readonly inner: RunStore,
    private readonly eventType: string,
    private readonly failureMessage = `Injected ${eventType} append failure`,
  ) {}

  createRun(input: Parameters<RunStore["createRun"]>[0]) { return this.inner.createRun(input); }
  getRun(runId: string) { return this.inner.getRun(runId); }
  updateRun(runId: string, update: RunUpdate, precondition?: RunUpdatePrecondition) {
    return this.inner.updateRun(runId, update, precondition);
  }
  listEvents(runId: string, afterSequence?: number) { return this.inner.listEvents(runId, afterSequence); }
  subscribe(runId: string, listener: RunEventListener) { return this.inner.subscribe(runId, listener); }
  writeArtifact<TArtifact>(runId: string, artifact: TArtifact) { return this.inner.writeArtifact(runId, artifact); }

  async appendEvent<TData extends EventData>(runId: string, type: string, data?: TData): Promise<RunEvent<TData>> {
    if (!this.failed && type === this.eventType) {
      this.failed = true;
      throw new Error(this.failureMessage);
    }
    return this.inner.appendEvent(runId, type, data);
  }
}

class ApprovalObservationStore implements RunStore {
  statusWhenApprovalEventWasAppended: string | undefined;

  constructor(private readonly inner: RunStore) {}

  createRun(input: Parameters<RunStore["createRun"]>[0]) { return this.inner.createRun(input); }
  getRun(runId: string) { return this.inner.getRun(runId); }
  updateRun(runId: string, update: RunUpdate, precondition?: RunUpdatePrecondition) {
    return this.inner.updateRun(runId, update, precondition);
  }
  listEvents(runId: string, afterSequence?: number) { return this.inner.listEvents(runId, afterSequence); }
  subscribe(runId: string, listener: RunEventListener) { return this.inner.subscribe(runId, listener); }
  writeArtifact<TArtifact>(runId: string, artifact: TArtifact) { return this.inner.writeArtifact(runId, artifact); }

  async appendEvent<TData extends EventData>(runId: string, type: string, data?: TData): Promise<RunEvent<TData>> {
    if (type === "approval.required") {
      this.statusWhenApprovalEventWasAppended = (await this.inner.getRun(runId))?.status;
    }
    return this.inner.appendEvent(runId, type, data);
  }
}

class DelayedCompletionStore implements RunStore {
  private releaseCompletionGate!: () => void;
  private markCompletionVisible!: () => void;
  private readonly completionGate = new Promise<void>((resolve) => {
    this.releaseCompletionGate = resolve;
  });
  readonly completionVisible = new Promise<void>((resolve) => {
    this.markCompletionVisible = resolve;
  });

  constructor(private readonly inner: RunStore) {}

  createRun(input: Parameters<RunStore["createRun"]>[0]) { return this.inner.createRun(input); }
  getRun(runId: string) { return this.inner.getRun(runId); }
  listEvents(runId: string, afterSequence?: number) { return this.inner.listEvents(runId, afterSequence); }
  subscribe(runId: string, listener: RunEventListener) { return this.inner.subscribe(runId, listener); }
  writeArtifact<TArtifact>(runId: string, artifact: TArtifact) { return this.inner.writeArtifact(runId, artifact); }
  appendEvent<TData extends EventData>(runId: string, type: string, data?: TData) {
    return this.inner.appendEvent(runId, type, data);
  }

  async updateRun(runId: string, update: RunUpdate, precondition?: RunUpdatePrecondition) {
    const updated = await this.inner.updateRun(runId, update, precondition);
    if (typeof update.completedAt === "string") {
      this.markCompletionVisible();
      await this.completionGate;
    }
    return updated;
  }

  releaseCompletion() {
    this.releaseCompletionGate();
  }
}

describe("DynamicHarnessRuntime policy and recovery", () => {
  it("does not report a terminal status until the local workflow has settled", async () => {
    const durable = await temporaryStore();
    const store = new DelayedCompletionStore(durable);
    const runtime = new DynamicHarnessRuntime({ store, delay: async () => undefined });
    const run = await runtime.start({ prompt: "Finish durably", spec: readOnlySpec() });
    const completion = runtime.waitForStatus(run.id, "completed");

    await store.completionVisible;
    let observed: "settled" | "pending";
    try {
      observed = await Promise.race([
        completion.then(() => "settled" as const),
        new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 25)),
      ]);
    } finally {
      store.releaseCompletion();
    }

    expect(observed).toBe("pending");
    await expect(completion).resolves.toMatchObject({ status: "completed" });
  });

  it("completes a read-only spec without inventing tools, subagents, or approvals", async () => {
    const store = await temporaryStore();
    const runtime = new DynamicHarnessRuntime({ store, delay: async () => undefined, statusTimeoutMs: 1_000 });
    const spec = readOnlySpec();

    const run = await runtime.start({ prompt: "Inspect only", spec });
    await runtime.waitForStatus(run.id, "completed");

    const events = await store.listEvents(run.id);
    const declared = new Set(spec.tools.filter((tool) => tool.enabled).map((tool) => tool.name));
    const toolNames = events
      .map((event) => event.data.tool)
      .filter((tool): tool is string => typeof tool === "string");

    expect(toolNames.every((tool) => declared.has(tool))).toBe(true);
    expect(events.some((event) => event.type.startsWith("subagent."))).toBe(false);
    expect(events.some((event) => event.type.startsWith("approval."))).toBe(false);
    expect(events.some((event) => event.data.tool === "runtime.inspect")).toBe(false);
    expect(events.some((event) => event.data.tool === "blueprint.write")).toBe(false);
  });

  it("caps isolated branches at the declared maxParallel value", async () => {
    const store = await temporaryStore();
    const runtime = new DynamicHarnessRuntime({ store, delay: async () => undefined });
    const spec: HarnessSpec = {
      ...defaultHarnessSpec,
      runtime: {
        ...defaultHarnessSpec.runtime,
        subagents: { enabled: true, maxParallel: 1 },
      },
    };

    const run = await runtime.start({ prompt: "Use one worker", spec });
    const waiting = await runtime.waitForStatus(run.id, "waiting_for_approval");
    const events = await store.listEvents(run.id);
    expect(events.filter((event) => event.type === "subagent.started")).toHaveLength(1);

    await runtime.resolveApproval({
      runId: run.id,
      approvalId: waiting.pendingApprovalId!,
      decision: "deny",
    });
    await runtime.waitForStatus(run.id, "completed");
  });

  it("resolves a persisted approval after the runtime instance is replaced", async () => {
    const store = await temporaryStore();
    const firstRuntime = new DynamicHarnessRuntime({ store, delay: async () => undefined });
    const run = await firstRuntime.start({ prompt: "Survive a runtime replacement", spec: defaultHarnessSpec });
    const waiting = await firstRuntime.waitForStatus(run.id, "waiting_for_approval");

    const replacement = new DynamicHarnessRuntime({ store, delay: async () => undefined });
    await replacement.resolveApproval({
      runId: run.id,
      approvalId: waiting.pendingApprovalId!,
      decision: "deny",
    });

    const completed = await replacement.waitForStatus(run.id, "completed");
    expect(completed.approvalDecision).toBe("deny");
  });

  it("makes the waiting state durable before publishing the approval prompt", async () => {
    const durable = await temporaryStore();
    const store = new ApprovalObservationStore(durable);
    const runtime = new DynamicHarnessRuntime({ store, delay: async () => undefined });

    const run = await runtime.start({ prompt: "Order approval safely", spec: defaultHarnessSpec });
    await runtime.waitForStatus(run.id, "waiting_for_approval");

    expect(store.statusWhenApprovalEventWasAppended).toBe("waiting_for_approval");
  });

  it("allows an approval retry after a transient approval event write failure", async () => {
    const durable = await temporaryStore();
    const store = new FailOnceEventStore(durable, "approval.resolved");
    const runtime = new DynamicHarnessRuntime({ store, delay: async () => undefined });
    const run = await runtime.start({ prompt: "Retry approval safely", spec: defaultHarnessSpec });
    const waiting = await runtime.waitForStatus(run.id, "waiting_for_approval");
    const input = { runId: run.id, approvalId: waiting.pendingApprovalId!, decision: "deny" as const };

    await expect(runtime.resolveApproval(input)).rejects.toThrow(/Injected approval\.resolved/);
    expect((await durable.getRun(run.id))?.status).toBe("waiting_for_approval");

    await runtime.resolveApproval(input);
    await runtime.waitForStatus(run.id, "completed");
    const resolutions = (await durable.listEvents(run.id)).filter((event) => event.type === "approval.resolved");
    expect(resolutions).toHaveLength(1);
  });

  it("serializes concurrent decisions for the same approval exactly once", async () => {
    const store = await temporaryStore();
    const runtime = new DynamicHarnessRuntime({ store, delay: async () => undefined });
    const run = await runtime.start({ prompt: "Resolve once", spec: defaultHarnessSpec });
    const waiting = await runtime.waitForStatus(run.id, "waiting_for_approval");
    const input = {
      runId: run.id,
      approvalId: waiting.pendingApprovalId!,
      decision: "deny" as const,
    };

    const outcomes = await Promise.allSettled([
      runtime.resolveApproval(input),
      runtime.resolveApproval(input),
    ]);
    await runtime.waitForStatus(run.id, "completed");

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect((await store.listEvents(run.id)).filter((event) => event.type === "approval.resolved")).toHaveLength(1);
  });

  it("allows only one runtime instance to claim an approval side effect", async () => {
    const store = await temporaryStore();
    const starter = new DynamicHarnessRuntime({ store, delay: async () => undefined });
    const run = await starter.start({ prompt: "Claim once", spec: defaultHarnessSpec });
    const waiting = await starter.waitForStatus(run.id, "waiting_for_approval");
    const runtimes = [
      new DynamicHarnessRuntime({ store, delay: async () => undefined }),
      new DynamicHarnessRuntime({ store, delay: async () => undefined }),
    ];
    const input = {
      runId: run.id,
      approvalId: waiting.pendingApprovalId!,
      decision: "deny" as const,
    };

    const outcomes = await Promise.allSettled(runtimes.map((runtime) => runtime.resolveApproval(input)));
    const winnerIndex = outcomes.findIndex((outcome) => outcome.status === "fulfilled");

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    await runtimes[winnerIndex].waitForStatus(run.id, "completed");
    const events = await store.listEvents(run.id);
    expect(events.filter((event) => event.type === "approval.resolved")).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool.denied")).toHaveLength(1);
  });

  it("persists a stable public failure without leaking internal host paths", async () => {
    const durable = await temporaryStore();
    const store = new FailOnceEventStore(
      durable,
      "tool.started",
      "EACCES while opening /private/tenant/secrets.json",
    );
    const runtime = new DynamicHarnessRuntime({ store, delay: async () => undefined });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const run = await runtime.start({ prompt: "Fail safely", spec: readOnlySpec() });
    const failed = await runtime.waitForStatus(run.id, "failed");

    expect(failed.error).toBe("The local conformance run failed.");
    expect(JSON.stringify(failed)).not.toContain("/private/tenant");
    expect(JSON.stringify(await durable.listEvents(run.id))).not.toContain("/private/tenant");
  });
});
