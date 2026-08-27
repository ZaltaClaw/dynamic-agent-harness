import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultHarnessSpec } from "@/lib/harness/schema";
import { FileRunStore } from "@/lib/harness/store";
import type { RunRecord, RunStatus } from "@/lib/harness/store";

const roots: string[] = [];

async function createStore(): Promise<FileRunStore> {
  const root = await mkdtemp(join(tmpdir(), "dynamic-harness-store-state-"));
  roots.push(root);
  return new FileRunStore({ root, idFactory: () => "run-1" });
}

const statuses: RunStatus[] = ["created", "running", "waiting_for_approval", "completed", "failed"];

const setupTransitions: Record<RunStatus, RunStatus[]> = {
  created: [],
  running: ["running"],
  waiting_for_approval: ["running", "waiting_for_approval"],
  completed: ["running", "completed"],
  failed: ["failed"],
};

const legalTransitions: Record<RunStatus, RunStatus[]> = {
  created: ["created", "running", "failed"],
  running: ["running", "waiting_for_approval", "completed", "failed"],
  waiting_for_approval: ["waiting_for_approval", "running", "failed"],
  completed: ["completed"],
  failed: ["failed"],
};

async function createRunAtStatus(store: FileRunStore, status: RunStatus): Promise<RunRecord> {
  let run = await store.createRun({ prompt: "Enforce state", spec: defaultHarnessSpec });
  for (const nextStatus of setupTransitions[status]) {
    run = await store.updateRun(run.id, { status: nextStatus });
  }
  return run;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileRunStore run state", () => {
  it("starts revisions at zero and increments them on every update", async () => {
    const store = await createStore();
    const created = await store.createRun({ prompt: "Track state", spec: defaultHarnessSpec });

    expect(created.revision).toBe(0);

    const running = await store.updateRun(created.id, { status: "running" });
    const annotated = await store.updateRun(created.id, { finalMessage: "Still running" });

    expect(running.revision).toBe(1);
    expect(annotated.revision).toBe(2);
    expect((await store.getRun(created.id))?.revision).toBe(2);
  });

  it("allows only one concurrent update at an expected revision", async () => {
    const store = await createStore();
    const created = await store.createRun({ prompt: "Coordinate writers", spec: defaultHarnessSpec });

    const outcomes = await Promise.allSettled([
      store.updateRun(created.id, { finalMessage: "writer one" }, { expectedRevision: 0 }),
      store.updateRun(created.id, { finalMessage: "writer two" }, { expectedRevision: 0 }),
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0]).toMatchObject({ value: { revision: 1 } });
    expect(rejected[0]).toMatchObject({ reason: { message: "Run update conflict" } });
    expect((rejected[0] as PromiseRejectedResult).reason.message).not.toContain(store.root);
    expect((await store.getRun(created.id))?.revision).toBe(1);
  });

  it("checks an expected status with the same generic conflict", async () => {
    const store = await createStore();
    const created = await store.createRun({ prompt: "Coordinate states", spec: defaultHarnessSpec });
    const running = await store.updateRun(created.id, { status: "running" });

    const conflict = await store
      .updateRun(created.id, { finalMessage: "stale write" }, { expectedStatus: "created" })
      .catch((error: unknown) => error);

    expect(conflict).toBeInstanceOf(Error);
    expect((conflict as Error).message).toBe("Run update conflict");
    expect((conflict as Error).message).not.toContain(store.root);
    expect(await store.getRun(created.id)).toMatchObject({ revision: 1, status: "running" });
    expect((await store.getRun(created.id))?.finalMessage).toBeUndefined();

    const annotated = await store.updateRun(
      created.id,
      { finalMessage: "current write" },
      { expectedStatus: running.status },
    );
    expect(annotated).toMatchObject({ revision: 2, status: "running", finalMessage: "current write" });
  });

  it("enforces the complete legal status transition graph", async () => {
    for (const currentStatus of statuses) {
      for (const nextStatus of statuses) {
        const store = await createStore();
        const current = await createRunAtStatus(store, currentStatus);
        const [outcome] = await Promise.allSettled([
          store.updateRun(current.id, { status: nextStatus, finalMessage: `${currentStatus} to ${nextStatus}` }),
        ]);

        if (legalTransitions[currentStatus].includes(nextStatus)) {
          expect(outcome).toMatchObject({
            status: "fulfilled",
            value: { status: nextStatus, revision: current.revision + 1 },
          });
          continue;
        }

        expect(outcome).toMatchObject({
          status: "rejected",
          reason: { message: "Invalid run status transition" },
        });
        expect(await store.getRun(current.id)).toMatchObject({
          status: currentStatus,
          revision: current.revision,
        });
        expect((await store.getRun(current.id))?.finalMessage).toBeUndefined();
      }
    }
  });
});
