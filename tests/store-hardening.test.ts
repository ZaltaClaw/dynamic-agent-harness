import { constants } from "node:fs";
import type { PathLike } from "node:fs";
import {
  access,
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultHarnessSpec } from "@/lib/harness/schema";
import { FileRunStore } from "@/lib/harness/store";

const syncTracker = vi.hoisted(() => ({ enabled: false, paths: [] as string[] }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();

  return {
    ...actual,
    open: async (path: PathLike, flags: string | number, mode?: string | number) => {
      const handle = await actual.open(path, flags, mode);
      if (syncTracker.enabled) {
        const sync = handle.sync.bind(handle);
        Object.defineProperty(handle, "sync", {
          configurable: true,
          value: async () => {
            syncTracker.paths.push(String(path));
            return sync();
          },
        });
      }
      return handle;
    },
  };
});

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dynamic-harness-store-hardening-"));
  roots.push(root);
  return root;
}

function storeAt(root: string, id = "run-1"): FileRunStore {
  return new FileRunStore({ root, idFactory: () => id });
}

async function createRun(root: string, id = "run-1") {
  return storeAt(root, id).createRun({ prompt: "Harden the store", spec: defaultHarnessSpec });
}

async function permissionBits(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

afterEach(async () => {
  syncTracker.enabled = false;
  syncTracker.paths = [];
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileRunStore hardening", () => {
  it("enforces private modes on existing store directories and files", async () => {
    const root = await temporaryRoot();
    const run = await createRun(root);
    const store = storeAt(root);
    await store.writeArtifact(run.id, { ok: true });

    const directories = [root, join(root, "runs"), join(root, "events"), join(root, "artifacts")];
    const files = [
      join(root, "runs", `${run.id}.json`),
      join(root, "events", `${run.id}.jsonl`),
      join(root, "artifacts", `${run.id}.json`),
    ];
    const temporaryPath = join(root, "runs", `${run.id}.json.abandoned.tmp`);
    await writeFile(temporaryPath, "temporary", { mode: 0o666 });

    await Promise.all(directories.map((path) => chmod(path, 0o777)));
    await Promise.all([...files, temporaryPath].map((path) => chmod(path, 0o666)));

    await store.listEvents(run.id);

    await Promise.all(directories.map(async (path) => expect(await permissionBits(path)).toBe(0o700)));
    await Promise.all([...files, temporaryPath].map(async (path) => expect(await permissionBits(path)).toBe(0o600)));
  });

  it("returns an opaque logical artifact path", async () => {
    const root = await temporaryRoot();
    const run = await createRun(root);

    const artifactPath = await storeAt(root).writeArtifact(run.id, { ok: true });

    expect(artifactPath).toBe(`artifacts/${run.id}.json`);
    expect(artifactPath).not.toContain(root);
    expect(JSON.parse(await readFile(join(root, artifactPath), "utf8"))).toEqual({ ok: true });
  });

  it("reports a missing event log for an existing run as corruption", async () => {
    const root = await temporaryRoot();
    const run = await createRun(root);
    const eventsPath = join(root, "events", `${run.id}.jsonl`);
    await rm(eventsPath);

    await expect(storeAt(root).listEvents(run.id)).rejects.toThrow(
      `Corrupt event log for run '${run.id}': event log is missing`,
    );
  });

  it("does not recreate a missing event log while appending", async () => {
    const root = await temporaryRoot();
    const run = await createRun(root);
    const eventsPath = join(root, "events", `${run.id}.jsonl`);
    await rm(eventsPath);

    await expect(storeAt(root).appendEvent(run.id, "run.started")).rejects.toThrow(
      `Corrupt event log for run '${run.id}': event log is missing`,
    );
    await expect(access(eventsPath, constants.F_OK)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("truncates only a torn invalid final JSONL fragment", async () => {
    const root = await temporaryRoot();
    const run = await createRun(root);
    const store = storeAt(root);
    await store.appendEvent(run.id, "run.started");
    await store.appendEvent(run.id, "tool.completed");
    const eventsPath = join(root, "events", `${run.id}.jsonl`);
    const completeContents = await readFile(eventsPath, "utf8");
    await appendFile(eventsPath, '{"id":"torn');

    const recovered = await store.listEvents(run.id);

    expect(recovered.map((event) => event.sequence)).toEqual([1, 2]);
    expect(await readFile(eventsPath, "utf8")).toBe(completeContents);
    expect((await store.appendEvent(run.id, "run.completed")).sequence).toBe(3);
  });

  it("normalizes a valid final JSONL record that lacks a newline", async () => {
    const root = await temporaryRoot();
    const run = await createRun(root);
    const store = storeAt(root);
    await store.appendEvent(run.id, "run.started");
    await store.appendEvent(run.id, "run.completed");
    const eventsPath = join(root, "events", `${run.id}.jsonl`);
    const completeContents = await readFile(eventsPath, "utf8");
    await writeFile(eventsPath, completeContents.slice(0, -1), "utf8");

    expect((await store.listEvents(run.id)).map((event) => event.sequence)).toEqual([1, 2]);
    expect(await readFile(eventsPath, "utf8")).toBe(completeContents);
  });

  it("does not discard an invalid newline-terminated JSONL record", async () => {
    const root = await temporaryRoot();
    const run = await createRun(root);
    const store = storeAt(root);
    await store.appendEvent(run.id, "run.started");
    const eventsPath = join(root, "events", `${run.id}.jsonl`);
    await appendFile(eventsPath, "not-json\n");

    await expect(store.listEvents(run.id)).rejects.toThrow(
      `Corrupt event log for run '${run.id}': invalid JSONL event at line 2`,
    );
  });

  it("recovers an old stale directory lock", async () => {
    const root = await temporaryRoot();
    const run = await createRun(root);
    const lockPath = join(root, "runs", `${run.id}.json.lock`);
    await mkdir(lockPath, { mode: 0o777 });
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleTime, staleTime);
    const updated = await storeAt(root).updateRun(run.id, { status: "running" });

    expect(updated).toMatchObject({ status: "running" });
    await expect(access(lockPath, constants.F_OK)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("bounds lock acquisition errors without exposing the store root", async () => {
    const root = await temporaryRoot();
    const run = await createRun(root);
    const lockPath = join(root, "runs", `${run.id}.json.lock`);
    await mkdir(lockPath);
    const store = new FileRunStore({
      root,
      idFactory: () => run.id,
      lockAcquireTimeoutMs: 25,
      lockStaleAfterMs: 1_000,
      lockRetryDelayMs: 2,
    });
    const [outcome] = await Promise.allSettled([
      store.updateRun(run.id, { status: "running" }),
    ]);

    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(outcome.reason).toBeInstanceOf(Error);
      expect((outcome.reason as Error).message).toBe("Timed out acquiring file lock");
      expect((outcome.reason as Error).message).not.toContain(root);
    }
  });

  it("rejects identifiers longer than 128 characters", async () => {
    const root = await temporaryRoot();
    const id = "a".repeat(129);

    await expect(createRun(root, id)).rejects.toThrow("Run id must be at most 128 characters");
  });

  it("accepts identifiers exactly 128 characters long", async () => {
    const root = await temporaryRoot();
    const id = "a".repeat(128);

    expect((await createRun(root, id)).id).toBe(id);
  });

  it("syncs durable file writes and their parent directories", async () => {
    const root = await temporaryRoot();
    const store = storeAt(root);
    syncTracker.enabled = true;

    const run = await store.createRun({ prompt: "Durable writes", spec: defaultHarnessSpec });
    await store.appendEvent(run.id, "run.started");
    await store.updateRun(run.id, { status: "running" });
    await store.writeArtifact(run.id, { ok: true });
    syncTracker.enabled = false;

    const runPath = join(root, "runs", `${run.id}.json`);
    const eventsPath = join(root, "events", `${run.id}.jsonl`);
    const artifactPath = join(root, "artifacts", `${run.id}.json`);
    expect(syncTracker.paths).toContain(runPath);
    expect(syncTracker.paths).toContain(eventsPath);
    expect(syncTracker.paths.some((path) => path.startsWith(`${runPath}.`) && path.endsWith(".tmp"))).toBe(true);
    expect(syncTracker.paths.some((path) => path.startsWith(`${artifactPath}.`) && path.endsWith(".tmp"))).toBe(true);
    expect(syncTracker.paths).toContain(join(root, "runs"));
    expect(syncTracker.paths).toContain(join(root, "events"));
    expect(syncTracker.paths).toContain(join(root, "artifacts"));
  });
});
