import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { HarnessSpec } from "@/lib/harness/schema";

export type RunStatus = "created" | "running" | "waiting_for_approval" | "completed" | "failed";

export type RunRecord = {
  id: string;
  prompt: string;
  spec: HarnessSpec;
  status: RunStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  pendingApprovalId?: string;
  approvalDecision?: "allow" | "deny";
  artifactPath?: string;
  finalMessage?: string;
  error?: string;
};

export type CreateRunInput = {
  prompt: string;
  spec: HarnessSpec;
};

export type RunUpdate = Partial<Omit<RunRecord, "id" | "createdAt" | "revision">>;
export type RunUpdatePrecondition = {
  expectedRevision?: number;
  expectedStatus?: RunStatus;
};
export type EventData = Record<string, unknown>;

export type RunEvent<TData extends EventData = EventData> = {
  id: string;
  runId: string;
  sequence: number;
  type: string;
  timestamp: string;
  data: TData;
};

export type RunEventListener = (event: RunEvent) => void | Promise<void>;

export interface RunStore {
  createRun(input: CreateRunInput): Promise<RunRecord>;
  getRun(runId: string): Promise<RunRecord | null>;
  updateRun(runId: string, update: RunUpdate, precondition?: RunUpdatePrecondition): Promise<RunRecord>;
  appendEvent<TData extends EventData>(runId: string, type: string, data?: TData): Promise<RunEvent<TData>>;
  listEvents(runId: string, afterSequence?: number): Promise<RunEvent[]>;
  subscribe(runId: string, listener: RunEventListener): () => void;
  writeArtifact<TArtifact>(runId: string, artifact: TArtifact): Promise<string>;
}

export type FileRunStoreOptions = {
  root: string;
  now?: () => Date;
  idFactory?: () => string;
  lockAcquireTimeoutMs?: number;
  lockStaleAfterMs?: number;
  lockRetryDelayMs?: number;
};

type LockTiming = {
  acquireTimeoutMs: number;
  staleAfterMs: number;
  retryDelayMs: number;
};

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_IDENTIFIER_LENGTH = 128;
const LOCK_ACQUIRE_TIMEOUT_MS = 30_000;
const LOCK_STALE_AFTER_MS = 60_000;
const LOCK_RETRY_DELAY_MS = 10;
const RUN_UPDATE_CONFLICT_MESSAGE = "Run update conflict";
const INVALID_STATUS_TRANSITION_MESSAGE = "Invalid run status transition";
const LEGAL_STATUS_CHANGES: Record<RunStatus, readonly RunStatus[]> = {
  created: ["running", "failed"],
  running: ["waiting_for_approval", "completed", "failed"],
  waiting_for_approval: ["running", "failed"],
  completed: [],
  failed: [],
};
const operationQueues = new Map<string, Promise<void>>();
const eventSubscribers = new Map<string, Set<RunEventListener>>();

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function syncDirectory(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    if (
      isFileSystemError(error, "EINVAL") ||
      isFileSystemError(error, "ENOTSUP") ||
      isFileSystemError(error, "EISDIR") ||
      isFileSystemError(error, "EBADF") ||
      isFileSystemError(error, "EPERM")
    ) {
      return;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function syncParentDirectory(path: string): Promise<void> {
  await syncDirectory(dirname(path));
}

async function writeNewFileDurably(path: string, contents: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, "wx", FILE_MODE);
    await handle.chmod(FILE_MODE);
    await handle.writeFile(contents, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle?.close();
  }
  await syncParentDirectory(path);
}

async function appendExistingFileDurably(path: string, contents: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_APPEND);
    await handle.chmod(FILE_MODE);
    await handle.writeFile(contents, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle?.close();
  }
  await syncParentDirectory(path);
}

async function truncateFileDurably(path: string, length: number): Promise<void> {
  let handle;
  try {
    handle = await open(path, "r+");
    await handle.chmod(FILE_MODE);
    await handle.truncate(length);
    await handle.sync();
  } finally {
    await handle?.close();
  }
  await syncParentDirectory(path);
}

async function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = operationQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolveTurn) => {
    release = resolveTurn;
  });
  const queued = previous.catch(() => undefined).then(() => turn);
  operationQueues.set(key, queued);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (operationQueues.get(key) === queued) {
      operationQueues.delete(key);
    }
  }
}

function lockError(message: string, cause?: unknown): Error {
  return cause === undefined ? new Error(message) : new Error(message, { cause });
}

async function recoverStaleDirectoryLock(
  lockPath: string,
  checkedAt: number,
  staleAfterMs: number,
): Promise<boolean> {
  let lockStats;
  try {
    lockStats = await stat(lockPath);
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) {
      return true;
    }
    throw lockError("Failed to inspect file lock", error);
  }

  if (checkedAt - lockStats.mtimeMs < staleAfterMs) {
    return false;
  }

  try {
    await rm(lockPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    throw lockError("Failed to recover stale file lock", error);
  }
}

async function withDirectoryLock<T>(
  lockPath: string,
  timing: LockTiming,
  operation: () => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + timing.acquireTimeoutMs;

  while (true) {
    try {
      await mkdir(lockPath, { mode: DIRECTORY_MODE });
      await chmod(lockPath, DIRECTORY_MODE);
      break;
    } catch (error) {
      if (!isFileSystemError(error, "EEXIST")) {
        throw lockError("Failed to acquire file lock", error);
      }
      const checkedAt = Date.now();
      const remaining = deadline - checkedAt;
      if (remaining <= 0) {
        throw lockError("Timed out acquiring file lock");
      }
      if (await recoverStaleDirectoryLock(lockPath, checkedAt, timing.staleAfterMs)) {
        continue;
      }
      await sleep(Math.min(timing.retryDelayMs, remaining));
    }
  }

  try {
    return await operation();
  } finally {
    try {
      await rm(lockPath, { recursive: true, force: true });
    } catch (error) {
      throw lockError("Failed to release file lock", error);
    }
  }
}

async function withExclusivePath<T>(path: string, timing: LockTiming, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  return serialize(lockPath, () => withDirectoryLock(lockPath, timing, operation));
}

function assertSafeIdentifier(value: string, label: string): void {
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`${label} must be at most ${MAX_IDENTIFIER_LENGTH} characters`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must contain only letters, numbers, underscores, and hyphens`);
  }
}

function eventLogCorruption(runId: string, detail: string, cause?: unknown): Error {
  const message = `Corrupt event log for run '${runId}': ${detail}`;
  return cause === undefined ? new Error(message) : new Error(message, { cause });
}

function parseEvents(contents: string, runId: string): RunEvent[] {
  if (contents.trim().length === 0) {
    return [];
  }

  const events: RunEvent[] = [];
  for (const [lineIndex, line] of contents.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      events.push(JSON.parse(line) as RunEvent);
    } catch (error) {
      throw eventLogCorruption(runId, `invalid JSONL event at line ${lineIndex + 1}`, error);
    }
  }

  for (const [eventIndex, event] of events.entries()) {
    const expectedSequence = eventIndex + 1;
    const receivedSequence = event && typeof event === "object" ? event.sequence : undefined;
    if (receivedSequence !== expectedSequence) {
      throw eventLogCorruption(
        runId,
        `expected event sequence ${expectedSequence}, received ${String(receivedSequence)}`,
      );
    }
  }

  return events;
}

async function ensurePrivateDirectory(path: string): Promise<boolean> {
  const created = await mkdir(path, { recursive: true, mode: DIRECTORY_MODE });
  await chmod(path, DIRECTORY_MODE);
  return created !== undefined;
}

async function correctStoredEntryModes(path: string): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() && !entry.isDirectory()) {
        return;
      }
      try {
        await chmod(join(path, entry.name), entry.isDirectory() ? DIRECTORY_MODE : FILE_MODE);
      } catch (error) {
        if (!isFileSystemError(error, "ENOENT")) {
          throw error;
        }
      }
    }),
  );
}

export class FileRunStore implements RunStore {
  readonly root: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly lockTiming: LockTiming;

  constructor(options: FileRunStoreOptions) {
    if (!options.root.trim()) {
      throw new Error("FileRunStore requires a non-empty root");
    }

    this.root = resolve(options.root);
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.lockTiming = {
      acquireTimeoutMs: options.lockAcquireTimeoutMs ?? LOCK_ACQUIRE_TIMEOUT_MS,
      staleAfterMs: options.lockStaleAfterMs ?? LOCK_STALE_AFTER_MS,
      retryDelayMs: options.lockRetryDelayMs ?? LOCK_RETRY_DELAY_MS,
    };
    if (Object.values(this.lockTiming).some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error("FileRunStore lock timings must be positive finite numbers");
    }
    if (this.lockTiming.staleAfterMs <= this.lockTiming.acquireTimeoutMs) {
      throw new Error("FileRunStore stale lock threshold must exceed its acquisition timeout");
    }
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    await this.ensureLayout();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = this.idFactory();
      assertSafeIdentifier(id, "Run id");
      const timestamp = this.timestamp();
      const run: RunRecord = {
        id,
        prompt: input.prompt,
        spec: input.spec,
        status: "created",
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const runPath = this.runPath(id);
      const eventsPath = this.eventsPath(id);

      try {
        await writeNewFileDurably(runPath, `${JSON.stringify(run, null, 2)}\n`);
      } catch (error) {
        if (isFileSystemError(error, "EEXIST") && attempt < 2) {
          continue;
        }
        throw error;
      }

      try {
        await writeNewFileDurably(eventsPath, "");
      } catch (error) {
        await rm(runPath, { force: true });
        await syncParentDirectory(runPath);
        if (isFileSystemError(error, "EEXIST") && attempt < 2) {
          continue;
        }
        throw error;
      }

      return run;
    }

    throw new Error("Unable to allocate a unique run id");
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const path = this.runPath(runId);
    await this.ensureLayout();
    try {
      return JSON.parse(await readFile(path, "utf8")) as RunRecord;
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) {
        return null;
      }
      throw error;
    }
  }

  async updateRun(runId: string, update: RunUpdate, precondition?: RunUpdatePrecondition): Promise<RunRecord> {
    await this.ensureLayout();
    const path = this.runPath(runId);

    return withExclusivePath(path, this.lockTiming, async () => {
      const current = await this.readRequiredRun(runId);
      if (
        (precondition?.expectedRevision !== undefined && current.revision !== precondition.expectedRevision) ||
        (precondition?.expectedStatus !== undefined && current.status !== precondition.expectedStatus)
      ) {
        throw new Error(RUN_UPDATE_CONFLICT_MESSAGE);
      }
      const nextStatus = update.status ?? current.status;
      if (nextStatus !== current.status && !LEGAL_STATUS_CHANGES[current.status].includes(nextStatus)) {
        throw new Error(INVALID_STATUS_TRANSITION_MESSAGE);
      }
      const updated: RunRecord = {
        ...current,
        ...update,
        id: current.id,
        status: nextStatus,
        revision: current.revision + 1,
        createdAt: current.createdAt,
        updatedAt: this.timestamp(),
      };
      await this.writeJsonAtomically(path, updated);
      return updated;
    });
  }

  async appendEvent<TData extends EventData>(
    runId: string,
    type: string,
    data: TData = {} as TData,
  ): Promise<RunEvent<TData>> {
    if (!type.trim()) {
      throw new Error("Event type must be non-empty");
    }

    await this.ensureLayout();
    const path = this.eventsPath(runId);
    const event = await withExclusivePath(path, this.lockTiming, async () => {
      await this.readRequiredRun(runId);
      const existing = await this.readEventsFile(runId, path);
      const sequence = (existing.at(-1)?.sequence ?? 0) + 1;
      const nextEvent: RunEvent<TData> = {
        id: `${runId}:${sequence}`,
        runId,
        sequence,
        type,
        timestamp: this.timestamp(),
        data,
      };
      const serialized = `${JSON.stringify(nextEvent)}\n`;
      try {
        await appendExistingFileDurably(path, serialized);
      } catch (error) {
        if (isFileSystemError(error, "ENOENT")) {
          throw eventLogCorruption(runId, "event log is missing", error);
        }
        throw error;
      }
      return JSON.parse(serialized) as RunEvent<TData>;
    });

    this.publish(event);
    return event;
  }

  async listEvents(runId: string, afterSequence = 0): Promise<RunEvent[]> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new Error("afterSequence must be a non-negative safe integer");
    }

    await this.ensureLayout();
    const path = this.eventsPath(runId);
    return withExclusivePath(path, this.lockTiming, async () => {
      await this.readRequiredRun(runId);
      const events = await this.readEventsFile(runId, path);
      return events.filter((event) => event.sequence > afterSequence);
    });
  }

  subscribe(runId: string, listener: RunEventListener): () => void {
    const path = this.eventsPath(runId);
    const listeners = eventSubscribers.get(path) ?? new Set<RunEventListener>();
    listeners.add(listener);
    eventSubscribers.set(path, listeners);
    let subscribed = true;

    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      listeners.delete(listener);
      if (listeners.size === 0) {
        eventSubscribers.delete(path);
      }
    };
  }

  async writeArtifact<TArtifact>(runId: string, artifact: TArtifact): Promise<string> {
    await this.ensureLayout();
    await this.readRequiredRun(runId);
    const path = this.artifactPath(runId);
    await withExclusivePath(path, this.lockTiming, () => this.writeJsonAtomically(path, artifact));
    return `artifacts/${runId}.json`;
  }

  artifactPath(runId: string): string {
    assertSafeIdentifier(runId, "Run id");
    return join(this.root, "artifacts", `${runId}.json`);
  }

  private runPath(runId: string): string {
    assertSafeIdentifier(runId, "Run id");
    return join(this.root, "runs", `${runId}.json`);
  }

  private eventsPath(runId: string): string {
    assertSafeIdentifier(runId, "Run id");
    return join(this.root, "events", `${runId}.jsonl`);
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private async ensureLayout(): Promise<void> {
    const rootCreated = await ensurePrivateDirectory(this.root);
    if (rootCreated) {
      await syncParentDirectory(this.root);
    }

    const directories = [join(this.root, "runs"), join(this.root, "events"), join(this.root, "artifacts")];
    const created = await Promise.all(directories.map((path) => ensurePrivateDirectory(path)));
    if (created.some(Boolean)) {
      await syncDirectory(this.root);
    }
    await Promise.all(directories.map((path) => correctStoredEntryModes(path)));
  }

  private async readRequiredRun(runId: string): Promise<RunRecord> {
    const run = await this.getRun(runId);
    if (!run) {
      throw new Error(`Run '${runId}' does not exist`);
    }
    return run;
  }

  private async readEventsFile(runId: string, path: string): Promise<RunEvent[]> {
    try {
      const contents = await readFile(path, "utf8");
      if (contents.length === 0 || contents.endsWith("\n")) {
        return parseEvents(contents, runId);
      }

      const finalNewline = contents.lastIndexOf("\n");
      const completeContents = finalNewline === -1 ? "" : contents.slice(0, finalNewline + 1);
      const finalFragment = contents.slice(finalNewline + 1);
      try {
        JSON.parse(finalFragment);
      } catch {
        const events = parseEvents(completeContents, runId);
        await truncateFileDurably(path, Buffer.byteLength(completeContents, "utf8"));
        return events;
      }

      const normalizedContents = `${contents}\n`;
      const events = parseEvents(normalizedContents, runId);
      await appendExistingFileDurably(path, "\n");
      return events;
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) {
        throw eventLogCorruption(runId, "event log is missing", error);
      }
      throw error;
    }
  }

  private async writeJsonAtomically(path: string, value: unknown): Promise<void> {
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeNewFileDurably(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
      await rename(temporaryPath, path);
      await chmod(path, FILE_MODE);
      await syncParentDirectory(path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private publish<TData extends EventData>(event: RunEvent<TData>): void {
    const listeners = eventSubscribers.get(this.eventsPath(event.runId));
    if (!listeners) {
      return;
    }

    for (const listener of [...listeners]) {
      try {
        void Promise.resolve(listener(event)).catch(() => undefined);
      } catch {
        // A subscriber cannot roll back an event that is already durable.
      }
    }
  }
}
