import { randomUUID } from "node:crypto";
import { compileHarnessBlueprint } from "@/lib/harness/compiler";
import { HarnessSpecSchema, RunPromptSchema, type HarnessSpec } from "@/lib/harness/schema";
import type { RunRecord, RunStatus, RunStore } from "@/lib/harness/store";

export type ApprovalDecision = "allow" | "deny";

export type StartRunInput = {
  prompt: string;
  spec: HarnessSpec;
};

export type ResolveApprovalInput = {
  runId: string;
  approvalId: string;
  decision: ApprovalDecision;
};

export type WaitForStatusOptions = {
  timeoutMs?: number;
  timeout?: number;
};

export type RuntimeDelay = (milliseconds: number) => Promise<void>;

export type DynamicHarnessRuntimeOptions = {
  store: RunStore;
  delay?: RuntimeDelay;
  statusTimeoutMs?: number;
};

type BranchDefinition = {
  id: string;
  role: string;
  tool: string;
  summary: string;
  delayMs: number;
};

type BranchResult = {
  branchId: string;
  isolationId: string;
  tool: string;
  summary: string;
};

type EnabledTool = HarnessSpec["tools"][number];

const defaultDelay: RuntimeDelay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function isTerminal(status: RunStatus): boolean {
  return status === "completed" || status === "failed";
}

export class DynamicHarnessRuntime {
  private readonly store: RunStore;
  private readonly delay: RuntimeDelay;
  private readonly statusTimeoutMs: number;
  private readonly workflows = new Map<string, Promise<void>>();
  private readonly approvalOperations = new Map<string, Promise<void>>();

  constructor(options: DynamicHarnessRuntimeOptions) {
    this.store = options.store;
    this.delay = options.delay ?? defaultDelay;
    this.statusTimeoutMs = options.statusTimeoutMs ?? 5_000;
  }

  async start(input: StartRunInput): Promise<RunRecord> {
    const prompt = RunPromptSchema.parse(input.prompt);
    const spec = HarnessSpecSchema.parse(input.spec);
    const created = await this.store.createRun({ prompt, spec });
    const startedAt = new Date().toISOString();

    let running: RunRecord;
    try {
      running = await this.transition(created, "running", { startedAt });
      await this.store.appendEvent(created.id, "run.started", {
        status: "running",
        adapter: "deterministic-runbook",
        summary: "Started the governed harness workflow.",
      });
    } catch (error) {
      await this.markFailed(created.id, error);
      throw error;
    }

    this.schedule(running.id, this.executeInitialGuarded(running));
    return running;
  }

  async waitForStatus(
    runId: string,
    status: RunStatus,
    timeout: number | WaitForStatusOptions = this.statusTimeoutMs,
  ): Promise<RunRecord> {
    const timeoutMs =
      typeof timeout === "number" ? timeout : (timeout.timeoutMs ?? timeout.timeout ?? this.statusTimeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new Error("Status wait timeout must be a non-negative finite number");
    }

    const initial = await this.store.getRun(runId);
    if (!initial) {
      throw new Error(`Run '${runId}' does not exist`);
    }
    if (await this.hasReachedStatus(initial, status)) {
      return initial;
    }

    return new Promise<RunRecord>((resolveWait, rejectWait) => {
      let settled = false;
      let checking = false;
      let unsubscribe: () => void = () => undefined;

      const cleanUp = () => {
        unsubscribe();
        if (interval) clearInterval(interval);
        if (timeoutHandle) clearTimeout(timeoutHandle);
      };
      const succeed = (run: RunRecord) => {
        if (settled) return;
        settled = true;
        cleanUp();
        resolveWait(run);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanUp();
        rejectWait(error);
      };
      const check = async () => {
        if (settled || checking) return;
        checking = true;
        try {
          const run = await this.store.getRun(runId);
          if (!run) {
            fail(new Error(`Run '${runId}' does not exist`));
          } else if (await this.hasReachedStatus(run, status)) {
            succeed(run);
          } else if (status !== "failed" && await this.hasReachedStatus(run, "failed")) {
            fail(new Error(`Run '${runId}' failed before reaching status '${status}': ${run.error ?? "unknown error"}`));
          }
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        } finally {
          checking = false;
        }
      };

      unsubscribe = this.store.subscribe(runId, () => void check());
      const interval = setInterval(() => void check(), 5);
      const timeoutHandle = setTimeout(() => {
        fail(new Error(`Timed out after ${timeoutMs}ms waiting for run '${runId}' to reach status '${status}'`));
      }, timeoutMs);
      void check();
    });
  }

  async resolveApproval(input: ResolveApprovalInput): Promise<RunRecord> {
    return this.serializeApproval(input.runId, () => this.resolveApprovalOnce(input));
  }

  private async resolveApprovalOnce(input: ResolveApprovalInput): Promise<RunRecord> {
    if (input.decision !== "allow" && input.decision !== "deny") {
      throw new Error(`Invalid approval decision '${String(input.decision)}'`);
    }
    if (!input.approvalId.trim()) {
      throw new Error("Approval id must be non-empty");
    }

    const run = await this.requiredRun(input.runId);
    if (run.status !== "waiting_for_approval" || !run.pendingApprovalId) {
      throw new Error(`Run '${input.runId}' is not waiting for approval`);
    }
    if (run.pendingApprovalId !== input.approvalId) {
      throw new Error(`Approval '${input.approvalId}' is not pending for run '${input.runId}'`);
    }
    if (run.approvalDecision && run.approvalDecision !== input.decision) {
      throw new Error(`Approval '${input.approvalId}' has already been claimed`);
    }

    const tool = this.artifactTool(run.spec);
    if (!tool) {
      throw new Error(`Approval '${input.approvalId}' has no declared capability for run '${input.runId}'`);
    }

    const claimed = await this.store.updateRun(
      run.id,
      { approvalDecision: input.decision },
      { expectedRevision: run.revision, expectedStatus: "waiting_for_approval" },
    );
    const existing = (await this.store.listEvents(input.runId)).find(
      (event) => event.type === "approval.resolved" && event.data.approvalId === input.approvalId,
    );
    if (existing && existing.data.decision !== input.decision) {
      throw new Error(`Approval '${input.approvalId}' has already been resolved`);
    }
    if (!existing) {
      await this.store.appendEvent(input.runId, "approval.resolved", {
        approvalId: input.approvalId,
        decision: input.decision,
        tool: tool.name,
        risk: tool.risk,
        summary: input.decision === "allow"
          ? `The governed ${tool.name} action was approved.`
          : `The governed ${tool.name} action was denied.`,
      });
    }

    const resumed = await this.transition(claimed, "running", {
      pendingApprovalId: undefined,
      approvalDecision: input.decision,
    });
    this.schedule(resumed.id, this.executeAfterApprovalGuarded(resumed, tool, input.decision));
    return resumed;
  }

  private async serializeApproval<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.approvalOperations.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolveTurn) => {
      release = resolveTurn;
    });
    const queued = previous.catch(() => undefined).then(() => turn);
    this.approvalOperations.set(runId, queued);

    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.approvalOperations.get(runId) === queued) {
        this.approvalOperations.delete(runId);
      }
    }
  }

  private schedule(runId: string, workflow: Promise<void>): void {
    this.workflows.set(runId, workflow);
    void workflow.finally(() => {
      if (this.workflows.get(runId) === workflow) this.workflows.delete(runId);
    });
  }

  private async executeInitialGuarded(run: RunRecord): Promise<void> {
    try {
      await this.executeInitialWorkflow(run);
    } catch (error) {
      await this.markFailed(run.id, error);
    }
  }

  private async executeAfterApprovalGuarded(
    run: RunRecord,
    tool: EnabledTool,
    decision: ApprovalDecision,
  ): Promise<void> {
    try {
      await this.completeAfterApproval(run, tool, decision);
    } catch (error) {
      await this.markFailed(run.id, error);
    }
  }

  private async executeInitialWorkflow(run: RunRecord): Promise<void> {
    const enabledReadTools = run.spec.tools.filter((tool) => tool.enabled && tool.risk === "read");
    if (run.spec.runtime.subagents.enabled) {
      const definitions = this.branchDefinitions(enabledReadTools).slice(0, run.spec.runtime.subagents.maxParallel);
      const branchResults = await Promise.all(
        definitions.map((definition) => this.runIsolatedBranch(run, definition)),
      );
      if (branchResults.length > 0) {
        await this.store.appendEvent(run.id, "subagents.joined", {
          branchIds: branchResults.map((result) => result.branchId),
          isolationIds: branchResults.map((result) => result.isolationId),
          summary: `Joined ${branchResults.length} isolated branch ${branchResults.length === 1 ? "summary" : "summaries"}.`,
        });
      }
    } else if (enabledReadTools[0]) {
      await this.runPrimaryRead(run, enabledReadTools[0]);
    }

    const tool = this.artifactTool(run.spec);
    if (!tool) {
      await this.completeWithoutArtifact(run);
      return;
    }
    await this.requestArtifactApproval(run, tool);
  }

  private branchDefinitions(tools: EnabledTool[]): BranchDefinition[] {
    const templates = [
      {
        id: "capability-scout",
        role: "capability scout",
        preferred: "catalog.discover",
        summary: "Confirmed the enabled capability and skill inventory.",
      },
      {
        id: "governance-reviewer",
        role: "governance reviewer",
        preferred: "context.audit",
        summary: "Confirmed the declared context, sandbox, and approval controls.",
      },
    ];
    const unused = [...tools];
    const definitions: BranchDefinition[] = [];
    for (const template of templates) {
      const preferredIndex = unused.findIndex((tool) => tool.name === template.preferred);
      const tool = preferredIndex >= 0 ? unused.splice(preferredIndex, 1)[0] : unused.shift();
      if (!tool) break;
      definitions.push({
        id: template.id,
        role: template.role,
        tool: tool.name,
        summary: template.summary,
        delayMs: 8,
      });
    }
    return definitions;
  }

  private async runPrimaryRead(run: RunRecord, tool: EnabledTool): Promise<void> {
    await this.store.appendEvent(run.id, "tool.started", {
      tool: tool.name,
      risk: tool.risk,
      summary: `Invoked ${tool.name} in the primary run context.`,
    });
    await this.delay(8);
    await this.store.appendEvent(run.id, "tool.completed", {
      tool: tool.name,
      risk: tool.risk,
      summary: `Completed ${tool.name} in the primary run context.`,
    });
  }

  private async runIsolatedBranch(run: RunRecord, definition: BranchDefinition): Promise<BranchResult> {
    const isolationId = randomUUID();
    await this.store.appendEvent(run.id, "subagent.started", {
      subagentId: definition.id,
      isolationId,
      role: definition.role,
      summary: `Started the isolated ${definition.role} branch.`,
    });
    await this.store.appendEvent(run.id, "tool.started", {
      subagentId: definition.id,
      isolationId,
      tool: definition.tool,
      risk: "read",
      summary: `Invoked ${definition.tool} in the isolated branch.`,
    });
    await this.delay(definition.delayMs);
    await this.store.appendEvent(run.id, "tool.completed", {
      subagentId: definition.id,
      isolationId,
      tool: definition.tool,
      risk: "read",
      summary: definition.summary,
    });
    await this.store.appendEvent(run.id, "subagent.completed", {
      subagentId: definition.id,
      isolationId,
      role: definition.role,
      summary: definition.summary,
    });
    return Object.freeze({
      branchId: definition.id,
      isolationId,
      tool: definition.tool,
      summary: definition.summary,
    });
  }

  private artifactTool(spec: HarnessSpec): EnabledTool | undefined {
    return spec.tools.find(
      (tool) => tool.enabled && tool.name === "blueprint.write" && tool.risk === "write",
    );
  }

  private async requestArtifactApproval(run: RunRecord, tool: EnabledTool): Promise<void> {
    const approvalId = randomUUID();
    await this.transition(run, "waiting_for_approval", {
      pendingApprovalId: approvalId,
    });
    await this.store.appendEvent(run.id, "approval.required", {
      approvalId,
      tool: tool.name,
      risk: tool.risk,
      action: "write a generated harness blueprint artifact",
      summary: `Approval is required before ${tool.name} writes the generated artifact.`,
    });
  }

  private async completeAfterApproval(
    run: RunRecord,
    tool: EnabledTool,
    decision: ApprovalDecision,
  ): Promise<void> {
    let artifactPath: string | undefined;
    let finalMessage: string;
    if (decision === "allow") {
      await this.store.appendEvent(run.id, "tool.started", {
        tool: tool.name,
        risk: tool.risk,
        summary: "Writing the approved harness blueprint.",
      });
      const blueprint = compileHarnessBlueprint(run.spec);
      artifactPath = await this.store.writeArtifact(run.id, blueprint);
      await this.store.appendEvent(run.id, "tool.completed", {
        tool: tool.name,
        risk: tool.risk,
        artifactPath,
        summary: "Persisted the approved harness blueprint.",
      });
      finalMessage = "The governed harness blueprint was approved and written.";
    } else {
      await this.store.appendEvent(run.id, "tool.denied", {
        tool: tool.name,
        risk: tool.risk,
        summary: "Skipped the artifact write because approval was denied.",
      });
      finalMessage = "The harness review completed; the blueprint write was denied.";
    }
    await this.completeRun(run.id, {
      decision,
      artifactPath,
      finalMessage,
    });
  }

  private async completeWithoutArtifact(run: RunRecord): Promise<void> {
    await this.completeRun(run.id, {
      finalMessage: "The harness review completed without an enabled artifact-writing capability.",
    });
  }

  private async completeRun(
    runId: string,
    result: { decision?: ApprovalDecision; artifactPath?: string; finalMessage: string },
  ): Promise<void> {
    await this.store.appendEvent(runId, "message.delta", {
      role: "assistant",
      delta: result.finalMessage,
    });
    await this.store.appendEvent(runId, "message.completed", {
      role: "assistant",
      content: result.finalMessage,
    });

    const current = await this.requiredRun(runId);
    const completed = await this.transition(current, "completed", {
      pendingApprovalId: undefined,
      approvalDecision: result.decision,
      artifactPath: result.artifactPath,
      finalMessage: result.finalMessage,
    });
    try {
      await this.store.appendEvent(runId, "run.completed", {
        status: completed.status,
        artifactPath: result.artifactPath ?? null,
        summary: result.finalMessage,
      });
    } catch {
      // The run record is authoritative; a terminal event append failure must not turn
      // a successfully persisted completion into a contradictory failed state.
    }
    await this.store.updateRun(runId, { completedAt: new Date().toISOString() });
  }

  private async transition(
    run: RunRecord,
    status: RunStatus,
    update: Omit<Partial<RunRecord>, "id" | "createdAt" | "status"> = {},
  ): Promise<RunRecord> {
    const current = await this.requiredRun(run.id);
    if (current.status !== run.status) {
      throw new Error(`Run '${run.id}' changed from '${run.status}' to '${current.status}' before transition`);
    }
    const updated = await this.store.updateRun(
      run.id,
      { ...update, status },
      { expectedRevision: current.revision, expectedStatus: current.status },
    );
    try {
      await this.store.appendEvent(run.id, "run.status_changed", {
        previousStatus: current.status,
        status,
        summary: `Run status changed from ${current.status} to ${status}.`,
      });
    } catch {
      // Status events are a replay aid; the atomically replaced run record is the
      // source of truth for state and must not be rolled back after persistence.
    }
    return updated;
  }

  private async requiredRun(runId: string): Promise<RunRecord> {
    const run = await this.store.getRun(runId);
    if (!run) throw new Error(`Run '${runId}' does not exist`);
    return run;
  }

  private async hasReachedStatus(run: RunRecord, status: RunStatus): Promise<boolean> {
    if (run.status !== status) return false;
    if (isTerminal(status)) {
      return typeof run.completedAt === "string" && !this.workflows.has(run.id);
    }
    if (status !== "waiting_for_approval") return true;
    if (!run.pendingApprovalId) return false;
    const events = await this.store.listEvents(run.id);
    return events.some(
      (event) => event.type === "approval.required" && event.data.approvalId === run.pendingApprovalId,
    );
  }

  private async markFailed(runId: string, error: unknown): Promise<void> {
    console.error("Harness run failed", error);
    const message = "The local conformance run failed.";
    try {
      const current = await this.store.getRun(runId);
      if (!current || isTerminal(current.status)) return;
      const failed = await this.transition(current, "failed", {
        pendingApprovalId: undefined,
        error: message,
      });
      try {
        await this.store.appendEvent(runId, "run.failed", {
          status: failed.status,
          summary: message,
        });
      } catch {
        // The failed state is already durable in the run record.
      }
      await this.store.updateRun(runId, { completedAt: new Date().toISOString() });
    } catch {
      // There is no useful recovery if the durable store itself is unavailable.
    }
  }
}
