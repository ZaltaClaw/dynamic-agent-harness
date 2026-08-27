import { describe, expect, it } from "vitest";
import { localhostRequestBoundary } from "@/app/api/runs/http";

describe("localhost request boundary", () => {
  it.each([
    ["http://localhost:3110/api/runs", "http://127.0.0.1:3110"],
    ["http://127.0.0.1:3110/api/runs", "http://localhost:3110"],
  ])("accepts equivalent loopback aliases on the same scheme and port", (url, origin) => {
    const result = localhostRequestBoundary(new Request(url, { headers: { origin } }));
    expect(result).toBeNull();
  });

  it.each([
    ["http://localhost:3110/api/runs", "http://localhost:3111"],
    ["http://localhost:3110/api/runs", "https://localhost:3110"],
    ["http://localhost:3110/api/runs", "http://example.test:3110"],
  ])("rejects origins outside the exact loopback endpoint", async (url, origin) => {
    const result = localhostRequestBoundary(new Request(url, { headers: { origin } }));
    expect(result?.status).toBe(403);
    await expect(result?.json()).resolves.toEqual({ error: "Forbidden request" });
  });
});
