import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DynamicHarnessRuntime } from "@/lib/harness/runtime";
import { FileRunStore } from "@/lib/harness/store";
import { defaultHarnessSpec } from "@/lib/harness/schema";

const roots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "dynamic-harness-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileRunStore", () => {
  it("persists ordered events and replays only events after a cursor", async () => {
    const root = await temporaryRoot();
    const store = new FileRunStore({ root });
    const run = await store.createRun({ prompt: "Build a governed incident harness", spec: defaultHarnessSpec });

    const first = await store.appendEvent(run.id, "run.started", { label: "started" });
    const second = await store.appendEvent(run.id, "tool.completed", { tool: "catalog.discover" });

    const reloaded = new FileRunStore({ root });
    expect(await reloaded.listEvents(run.id, first.sequence)).toEqual([second]);
    expect((await reloaded.getRun(run.id))?.prompt).toBe("Build a governed incident harness");
  });
});

describe("DynamicHarnessRuntime", () => {
  it("fans out isolated workers, pauses at a runtime approval gate, then writes a replayable artifact", async () => {
    const root = await temporaryRoot();
    const store = new FileRunStore({ root });
    const runtime = new DynamicHarnessRuntime({ store, delay: async () => undefined });

    const run = await runtime.start({ prompt: "Create our production incident harness", spec: defaultHarnessSpec });
    const waiting = await runtime.waitForStatus(run.id, "waiting_for_approval");
    expect(waiting.pendingApprovalId).toBeTruthy();

    const beforeApproval = await store.listEvents(run.id);
    expect(beforeApproval.filter((event) => event.type === "subagent.completed")).toHaveLength(2);
    expect(beforeApproval.some((event) => event.type === "approval.required")).toBe(true);

    await runtime.resolveApproval({
      runId: run.id,
      approvalId: waiting.pendingApprovalId!,
      decision: "allow",
    });
    const complete = await runtime.waitForStatus(run.id, "completed");
    expect(complete.status).toBe("completed");

    const artifact = JSON.parse(await readFile(join(root, "artifacts", `${run.id}.json`), "utf8"));
    expect(artifact.spec.slug).toBe(defaultHarnessSpec.slug);

    const events = await store.listEvents(run.id);
    expect(events.at(-1)?.type).toBe("run.completed");
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
  });

  it("does not write the artifact when approval is denied", async () => {
    const root = await temporaryRoot();
    const store = new FileRunStore({ root });
    const runtime = new DynamicHarnessRuntime({ store, delay: async () => undefined });

    const run = await runtime.start({ prompt: "Create a harness", spec: defaultHarnessSpec });
    const waiting = await runtime.waitForStatus(run.id, "waiting_for_approval");
    await runtime.resolveApproval({
      runId: run.id,
      approvalId: waiting.pendingApprovalId!,
      decision: "deny",
    });
    await runtime.waitForStatus(run.id, "completed");

    const events = await store.listEvents(run.id);
    expect(events.some((event) => event.type === "tool.denied")).toBe(true);
    await expect(readFile(join(root, "artifacts", `${run.id}.json`), "utf8")).rejects.toThrow();
  });
});
