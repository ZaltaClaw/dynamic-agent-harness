import { describe, expect, it } from "vitest";
import { HarnessSpecSchema, defaultHarnessSpec } from "@/lib/harness/schema";

describe("HarnessSpecSchema", () => {
  it("accepts the production-ready default spec", () => {
    const parsed = HarnessSpecSchema.parse(defaultHarnessSpec);
    expect(parsed.slug).toBe("incident-triage");
    expect(parsed.runtime.durableSessions).toBe(true);
    expect(parsed.runtime.approvals.requiredFor).toContain("write");
  });

  it("rejects duplicate tool names", () => {
    const duplicate = {
      ...defaultHarnessSpec,
      tools: [defaultHarnessSpec.tools[0], defaultHarnessSpec.tools[0]],
    };
    expect(() => HarnessSpecSchema.parse(duplicate)).toThrow(/unique/i);
  });

  it("rejects a write tool without a runtime approval gate", () => {
    const unsafe = {
      ...defaultHarnessSpec,
      runtime: {
        ...defaultHarnessSpec.runtime,
        approvals: { requiredFor: ["delete"] },
      },
    };
    expect(() => HarnessSpecSchema.parse(unsafe)).toThrow(/write tool/i);
  });

  it("bounds attacker-controlled strings and collection sizes", () => {
    expect(
      HarnessSpecSchema.safeParse({
        ...defaultHarnessSpec,
        model: { ...defaultHarnessSpec.model, id: "m".repeat(257) },
      }).success,
    ).toBe(false);
    expect(
      HarnessSpecSchema.safeParse({
        ...defaultHarnessSpec,
        tools: [{ ...defaultHarnessSpec.tools[0], description: "d".repeat(1_001) }],
      }).success,
    ).toBe(false);
    expect(
      HarnessSpecSchema.safeParse({
        ...defaultHarnessSpec,
        tools: Array.from({ length: 65 }, (_, index) => ({
          ...defaultHarnessSpec.tools[0],
          name: `read.tool-${index}`,
        })),
      }).success,
    ).toBe(false);
    expect(
      HarnessSpecSchema.safeParse({
        ...defaultHarnessSpec,
        skills: Array.from({ length: 65 }, (_, index) => ({
          ...defaultHarnessSpec.skills[0],
          name: `skill-${index}`,
        })),
      }).success,
    ).toBe(false);
  });
});
