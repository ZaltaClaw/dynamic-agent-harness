import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultHarnessSpec } from "@/lib/harness/schema";

const serviceMocks = vi.hoisted(() => ({
  start: vi.fn(),
  getRun: vi.fn(),
  resolveApproval: vi.fn(),
}));

vi.mock("@/lib/harness/services", () => ({
  getHarnessServices: () => ({
    store: { getRun: serviceMocks.getRun },
    runtime: {
      start: serviceMocks.start,
      resolveApproval: serviceMocks.resolveApproval,
    },
  }),
}));

import { POST as createRun } from "@/app/api/runs/route";
import { GET as getRun } from "@/app/api/runs/[runId]/route";
import { POST as resolveApproval } from "@/app/api/runs/[runId]/approvals/route";

const validRunId = "550e8400-e29b-41d4-a716-446655440000";
const validApprovalId = "44c60d5a-90e6-4568-a170-d46f3f0d3d8b";
const unsupportedJsonContentTypes = [
  { label: "missing", value: undefined },
  { label: "text/plain", value: "text/plain" },
  { label: "form encoded", value: "application/x-www-form-urlencoded" },
  { label: "multipart", value: "multipart/form-data; boundary=test" },
] as const;

function routeContext(runId: string) {
  return { params: Promise.resolve({ runId }) };
}

function jsonRequest(url: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

function waitingRun(pendingApprovalId = validApprovalId) {
  return {
    id: validRunId,
    status: "waiting_for_approval",
    pendingApprovalId,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  serviceMocks.start.mockReset();
  serviceMocks.getRun.mockReset();
  serviceMocks.resolveApproval.mockReset();
});

describe("POST /api/runs", () => {
  it("returns a stable 403 before runtime access for a non-loopback request URL", async () => {
    const response = await createRun(jsonRequest(
      "http://example.test/api/runs",
      JSON.stringify({ prompt: "Investigate the incident", spec: defaultHarnessSpec }),
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden request" });
    expect(serviceMocks.start).not.toHaveBeenCalled();
  });

  it.each([
    "http://example.test",
    "http://localhost:3111",
    "https://localhost:3110",
  ])("returns a stable 403 when Origin %s is outside the same loopback endpoint", async (origin) => {
    const response = await createRun(jsonRequest(
      "http://localhost:3110/api/runs",
      JSON.stringify({ prompt: "Investigate the incident", spec: defaultHarnessSpec }),
      { origin },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden request" });
    expect(serviceMocks.start).not.toHaveBeenCalled();
  });

  it.each(unsupportedJsonContentTypes)(
    "returns a stable 415 before parsing for $label Content-Type",
    async ({ value: contentType }) => {
      const response = await createRun(new Request("http://localhost/api/runs", {
        method: "POST",
        headers: contentType ? { "content-type": contentType } : undefined,
        body: contentType
          ? JSON.stringify({ prompt: "Investigate the incident", spec: defaultHarnessSpec })
          : undefined,
      }));

      expect(response.status).toBe(415);
      await expect(response.json()).resolves.toEqual({ error: "Unsupported media type" });
      expect(serviceMocks.start).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for malformed JSON", async () => {
    const response = await createRun(jsonRequest(
      "http://localhost/api/runs",
      "{",
      { "content-type": "application/json; charset=utf-8" },
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid run request" });
    expect(serviceMocks.start).not.toHaveBeenCalled();
  });

  it("redacts unexpected errors behind a stable 500 response", async () => {
    const privateError = new Error("EACCES: /private/runtime/path");
    serviceMocks.start.mockRejectedValueOnce(privateError);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await createRun(jsonRequest(
      "http://localhost/api/runs",
      JSON.stringify({ prompt: "Investigate the incident", spec: defaultHarnessSpec }),
    ));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Run could not be started" });
    expect(log).toHaveBeenCalledWith("Failed to start run", privateError);
  });
});

describe("GET /api/runs/:runId", () => {
  it("returns a stable 403 before store access for a non-loopback request URL", async () => {
    const response = await getRun(
      new Request(`http://example.test/api/runs/${validRunId}`),
      routeContext(validRunId),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden request" });
    expect(serviceMocks.getRun).not.toHaveBeenCalled();
  });

  it("returns a stable 403 before store access for a cross-origin request", async () => {
    const response = await getRun(
      new Request(`http://localhost:3110/api/runs/${validRunId}`, {
        headers: { origin: "http://example.test" },
      }),
      routeContext(validRunId),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden request" });
    expect(serviceMocks.getRun).not.toHaveBeenCalled();
  });

  it.each(["http://localhost:3110", "http://127.0.0.1:3110"])(
    "allows the exact loopback Origin %s",
    async (origin) => {
      serviceMocks.getRun.mockResolvedValueOnce(null);
      const response = await getRun(
        new Request(`${origin}/api/runs/${validRunId}`, { headers: { origin } }),
        routeContext(validRunId),
      );

      expect(response.status).toBe(404);
      expect(serviceMocks.getRun).toHaveBeenCalledWith(validRunId);
    },
  );

  it.each([
    "../private",
    "run id",
    "run%2Fchild",
    "control\u0000char",
    "a".repeat(129),
  ])("returns 400 before store access for invalid run id %j", async (runId) => {
    const response = await getRun(
      new Request(`http://localhost/api/runs/${encodeURIComponent(runId)}`),
      routeContext(runId),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid run id" });
    expect(serviceMocks.getRun).not.toHaveBeenCalled();
  });

  it("returns 404 for a well-formed missing run", async () => {
    serviceMocks.getRun.mockResolvedValueOnce(null);

    const response = await getRun(
      new Request(`http://localhost/api/runs/${validRunId}`),
      routeContext(validRunId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Run not found" });
  });

  it("redacts unexpected store errors behind a stable 500 response", async () => {
    const privateError = new Error("corrupt record at /private/runs/file.json");
    serviceMocks.getRun.mockRejectedValueOnce(privateError);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await getRun(
      new Request(`http://localhost/api/runs/${validRunId}`),
      routeContext(validRunId),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Run could not be loaded" });
    expect(log).toHaveBeenCalledWith("Failed to load run", privateError);
  });
});

describe("POST /api/runs/:runId/approvals", () => {
  const validBody = JSON.stringify({ approvalId: validApprovalId, decision: "allow" });

  it("returns a stable 403 before service access for a non-loopback request URL", async () => {
    const response = await resolveApproval(
      jsonRequest(`http://example.test/api/runs/${validRunId}/approvals`, validBody),
      routeContext(validRunId),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden request" });
    expect(serviceMocks.getRun).not.toHaveBeenCalled();
    expect(serviceMocks.resolveApproval).not.toHaveBeenCalled();
  });

  it("returns a stable 403 before service access for a cross-origin request", async () => {
    const response = await resolveApproval(
      jsonRequest(
        `http://127.0.0.1:3110/api/runs/${validRunId}/approvals`,
        validBody,
        { origin: "http://localhost:3111" },
      ),
      routeContext(validRunId),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden request" });
    expect(serviceMocks.getRun).not.toHaveBeenCalled();
    expect(serviceMocks.resolveApproval).not.toHaveBeenCalled();
  });

  it.each(unsupportedJsonContentTypes)(
    "returns a stable 415 before parsing for $label Content-Type",
    async ({ value: contentType }) => {
      const response = await resolveApproval(
        new Request(`http://localhost/api/runs/${validRunId}/approvals`, {
          method: "POST",
          headers: contentType ? { "content-type": contentType } : undefined,
          body: contentType ? validBody : undefined,
        }),
        routeContext(validRunId),
      );

      expect(response.status).toBe(415);
      await expect(response.json()).resolves.toEqual({ error: "Unsupported media type" });
      expect(serviceMocks.getRun).not.toHaveBeenCalled();
      expect(serviceMocks.resolveApproval).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for malformed JSON", async () => {
    const response = await resolveApproval(
      jsonRequest(
        `http://localhost/api/runs/${validRunId}/approvals`,
        "{",
        { "content-type": "application/json; charset=utf-8" },
      ),
      routeContext(validRunId),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid approval request" });
    expect(serviceMocks.resolveApproval).not.toHaveBeenCalled();
  });

  it("returns 400 before service access for an invalid run id", async () => {
    const response = await resolveApproval(
      jsonRequest("http://localhost/api/runs/bad/approvals", validBody),
      routeContext("../bad"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid run id" });
    expect(serviceMocks.getRun).not.toHaveBeenCalled();
    expect(serviceMocks.resolveApproval).not.toHaveBeenCalled();
  });

  it.each([
    "   ",
    "../approval",
    "approval id",
    "a".repeat(129),
  ])("returns 400 for invalid approval id %j", async (approvalId) => {
    const response = await resolveApproval(
      jsonRequest(
        `http://localhost/api/runs/${validRunId}/approvals`,
        JSON.stringify({ approvalId, decision: "allow" }),
      ),
      routeContext(validRunId),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid approval request" });
    expect(serviceMocks.getRun).not.toHaveBeenCalled();
    expect(serviceMocks.resolveApproval).not.toHaveBeenCalled();
  });

  it("returns 404 when the run is missing", async () => {
    serviceMocks.getRun.mockResolvedValueOnce(null);

    const response = await resolveApproval(
      jsonRequest(`http://localhost/api/runs/${validRunId}/approvals`, validBody),
      routeContext(validRunId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Run not found" });
    expect(serviceMocks.resolveApproval).not.toHaveBeenCalled();
  });

  it.each([
    { status: "completed", pendingApprovalId: undefined },
    { status: "waiting_for_approval", pendingApprovalId: "other-approval" },
  ])("returns 409 for a conflicting run state %#", async (runState) => {
    serviceMocks.getRun.mockResolvedValueOnce({ id: validRunId, ...runState });

    const response = await resolveApproval(
      jsonRequest(`http://localhost/api/runs/${validRunId}/approvals`, validBody),
      routeContext(validRunId),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Approval conflict" });
    expect(serviceMocks.resolveApproval).not.toHaveBeenCalled();
  });

  it("maps an approval race to 409 without leaking the runtime message", async () => {
    serviceMocks.getRun
      .mockResolvedValueOnce(waitingRun())
      .mockResolvedValueOnce({ id: validRunId, status: "running", pendingApprovalId: undefined });
    serviceMocks.resolveApproval.mockRejectedValueOnce(
      new Error(`Approval '${validApprovalId}' has already been resolved`),
    );

    const response = await resolveApproval(
      jsonRequest(`http://localhost/api/runs/${validRunId}/approvals`, validBody),
      routeContext(validRunId),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Approval conflict" });
  });

  it("classifies an opaque approval race from durable state rather than error text", async () => {
    serviceMocks.getRun
      .mockResolvedValueOnce(waitingRun())
      .mockResolvedValueOnce({ id: validRunId, status: "running", pendingApprovalId: undefined });
    serviceMocks.resolveApproval.mockRejectedValueOnce(new Error("opaque adapter failure"));

    const response = await resolveApproval(
      jsonRequest(`http://localhost/api/runs/${validRunId}/approvals`, validBody),
      routeContext(validRunId),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Approval conflict" });
  });

  it("redacts unexpected runtime errors behind a stable 500 response", async () => {
    const privateError = new Error("EIO while appending /private/events/run.jsonl");
    serviceMocks.getRun.mockResolvedValue(waitingRun());
    serviceMocks.resolveApproval.mockRejectedValueOnce(privateError);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await resolveApproval(
      jsonRequest(`http://localhost/api/runs/${validRunId}/approvals`, validBody),
      routeContext(validRunId),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Approval could not be resolved" });
    expect(log).toHaveBeenCalledWith("Failed to resolve approval", privateError);
  });

  it("trims a valid approval id before resolving it", async () => {
    serviceMocks.getRun.mockResolvedValueOnce(waitingRun());
    serviceMocks.resolveApproval.mockResolvedValueOnce({ id: validRunId, status: "running" });

    const response = await resolveApproval(
      jsonRequest(
        `http://localhost/api/runs/${validRunId}/approvals`,
        JSON.stringify({ approvalId: `  ${validApprovalId}  `, decision: "deny" }),
      ),
      routeContext(validRunId),
    );

    expect(response.status).toBe(200);
    expect(serviceMocks.resolveApproval).toHaveBeenCalledWith({
      runId: validRunId,
      approvalId: validApprovalId,
      decision: "deny",
    });
  });
});
