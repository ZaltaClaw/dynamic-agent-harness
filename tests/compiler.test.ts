import { describe, expect, it } from "vitest";
import { compileHarnessBlueprint, toTrueForgeManifest } from "@/lib/harness/compiler";
import { defaultHarnessSpec } from "@/lib/harness/schema";

describe("harness compiler", () => {
  it("validates and strips direct compiler input through HarnessSpecSchema", () => {
    const withUnknownSecrets = {
      ...defaultHarnessSpec,
      internalApiKey: "must-not-be-exported",
      runtime: {
        ...defaultHarnessSpec.runtime,
        internalToken: "must-not-be-exported",
      },
    };

    const blueprint = compileHarnessBlueprint(withUnknownSecrets);
    expect(blueprint.spec).not.toHaveProperty("internalApiKey");
    expect(blueprint.spec.runtime).not.toHaveProperty("internalToken");

    const unsafe = {
      ...defaultHarnessSpec,
      runtime: {
        ...defaultHarnessSpec.runtime,
        approvals: { requiredFor: ["delete"] },
      },
    };
    expect(() => compileHarnessBlueprint(unsafe)).toThrow(/write tool/i);
    expect(() => toTrueForgeManifest(unsafe)).toThrow(/write tool/i);
  });

  it("compiles a portable blueprint with an explicit reliability contract", () => {
    const blueprint = compileHarnessBlueprint(defaultHarnessSpec);
    expect(blueprint.runtimeContract).toMatchObject({
      disconnectSafe: false,
      replayable: true,
      runtimeEnforcedApprovals: true,
      progressiveDisclosure: false,
      parallelIsolation: false,
      sandboxedExecution: false,
    });
    expect(blueprint.enabledCapabilities).toContain("blueprint.write");
    expect(blueprint.security.writeToolsWithoutApproval).toEqual([]);
  });

  it("translates the portable spec into a TrueForge-compatible agent manifest", () => {
    const manifest = toTrueForgeManifest({
      ...defaultHarnessSpec,
      runtime: {
        ...defaultHarnessSpec.runtime,
        sandbox: { ...defaultHarnessSpec.runtime.sandbox, network: "unrestricted" },
      },
    });
    expect(manifest.model.name).toBe(defaultHarnessSpec.model.id);
    expect(manifest.config.dynamic_sub_agents.enabled).toBe(true);
    expect(manifest.config.context_management.compaction.trigger).toEqual({
      type: "input_tokens",
      value: 48_000,
    });
    expect(manifest.skills).toHaveLength(2);
  });

  it("rejects unrepresentable network restrictions and preserves file-download policy", () => {
    expect(() => toTrueForgeManifest(defaultHarnessSpec)).toThrow(/network policy 'allowlist'.*cannot be represented/i);
    expect(() =>
      toTrueForgeManifest({
        ...defaultHarnessSpec,
        runtime: {
          ...defaultHarnessSpec.runtime,
          sandbox: { ...defaultHarnessSpec.runtime.sandbox, network: "none" },
        },
      }),
    ).toThrow(/network policy 'none'.*cannot be represented/i);

    const exportable = {
      ...defaultHarnessSpec,
      runtime: {
        ...defaultHarnessSpec.runtime,
        sandbox: {
          ...defaultHarnessSpec.runtime.sandbox,
          network: "unrestricted" as const,
          fileDownloads: false,
        },
      },
    };
    expect(toTrueForgeManifest(exportable).config.sandbox.file_downloads).toBe(false);
    expect(
      toTrueForgeManifest({
        ...exportable,
        runtime: {
          ...exportable.runtime,
          sandbox: { ...exportable.runtime.sandbox, fileDownloads: true },
        },
      }).config.sandbox.file_downloads,
    ).toBe(true);
  });

  it("does not claim runtime approval enforcement for unsupported custom mutations", () => {
    const spec = {
      ...defaultHarnessSpec,
      tools: [
        {
          name: "repository.patch",
          description: "A production adapter target that the local runbook does not execute.",
          risk: "write" as const,
          enabled: true,
          deferred: true,
        },
      ],
    };

    expect(compileHarnessBlueprint(spec).runtimeContract.runtimeEnforcedApprovals).toBe(false);
  });
});
