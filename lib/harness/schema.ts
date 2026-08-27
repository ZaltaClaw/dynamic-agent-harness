import { z } from "zod";

const RiskSchema = z.enum(["read", "write", "delete"]);

export const RunPromptSchema = z.string().trim().min(1).max(10_000);

export const ToolSpecSchema = z.object({
  name: z.string().trim().min(1).max(128).regex(/^[a-z][a-z0-9_.-]*$/),
  description: z.string().trim().min(8).max(1_000),
  risk: RiskSchema,
  enabled: z.boolean(),
  deferred: z.boolean().default(true),
});

export const SkillSpecSchema = z.object({
  name: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  description: z.string().trim().min(8).max(1_000),
  source: z.enum(["inline", "git", "registry"]),
  enabled: z.boolean(),
});

export const HarnessSpecSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(3).max(80),
    slug: z.string().trim().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    organization: z.string().trim().min(2).max(80),
    description: z.string().trim().min(12).max(240),
    model: z.object({
      provider: z.enum(["runbook", "openai-compatible", "anthropic", "azure-openai", "ollama"]),
      id: z
        .string()
        .trim()
        .min(1)
        .max(256)
        .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
      temperature: z.number().min(0).max(2),
    }),
    tools: z.array(ToolSpecSchema).min(1).max(64),
    skills: z.array(SkillSpecSchema).max(64),
    runtime: z.object({
      maxIterations: z.number().int().min(1).max(200),
      durableSessions: z.boolean(),
      eventRetentionDays: z.number().int().min(1).max(3650),
      subagents: z.object({
        enabled: z.boolean(),
        maxParallel: z.number().int().min(1).max(16),
      }),
      context: z.object({
        progressiveDisclosure: z.boolean(),
        largeResultOffload: z.boolean(),
        compaction: z.object({
          enabled: z.boolean(),
          thresholdTokens: z.number().int().min(1_000).max(2_000_000),
        }),
      }),
      approvals: z.object({
        requiredFor: z.array(RiskSchema).max(3),
      }),
      sandbox: z.object({
        provider: z.enum(["local", "container", "daytona"]),
        network: z.enum(["none", "allowlist", "unrestricted"]),
        fileDownloads: z.boolean().default(false),
      }),
      storage: z.enum(["jsonl", "sqlite", "postgres"]),
    }),
  })
  .superRefine((spec, context) => {
    const names = spec.tools.map((tool) => tool.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: "custom",
        message: "Tool names must be unique",
        path: ["tools"],
      });
    }

    const approvalRisks = new Set(spec.runtime.approvals.requiredFor);
    for (const tool of spec.tools) {
      if (tool.enabled && tool.risk !== "read" && !approvalRisks.has(tool.risk)) {
        context.addIssue({
          code: "custom",
          message: `${tool.risk} tool '${tool.name}' requires a runtime approval gate`,
          path: ["runtime", "approvals", "requiredFor"],
        });
      }
    }
  });

export type HarnessSpec = z.infer<typeof HarnessSpecSchema>;
export type ToolRisk = z.infer<typeof RiskSchema>;

export const defaultHarnessSpec: HarnessSpec = {
  version: 1,
  name: "Incident Triage Harness",
  slug: "incident-triage",
  organization: "Acme Operations",
  description: "A durable incident-response agent with governed tools, parallel specialists, and replayable execution.",
  model: {
    provider: "runbook",
    id: "deterministic-ops-v1",
    temperature: 0.2,
  },
  tools: [
    {
      name: "catalog.discover",
      description: "Discover approved organizational capabilities without loading every schema.",
      risk: "read",
      enabled: true,
      deferred: false,
    },
    {
      name: "context.audit",
      description: "Inspect the active context budget and recommend compaction or offloading.",
      risk: "read",
      enabled: true,
      deferred: true,
    },
    {
      name: "blueprint.write",
      description: "Persist a generated organizational harness blueprint as a reviewable artifact.",
      risk: "write",
      enabled: true,
      deferred: true,
    },
  ],
  skills: [
    {
      name: "incident-triage",
      description: "A procedure for evidence-first incident classification and escalation.",
      source: "inline",
      enabled: true,
    },
    {
      name: "postmortem-builder",
      description: "Turns the final event trace into a structured postmortem outline.",
      source: "git",
      enabled: true,
    },
  ],
  runtime: {
    maxIterations: 24,
    durableSessions: true,
    eventRetentionDays: 30,
    subagents: { enabled: true, maxParallel: 3 },
    context: {
      progressiveDisclosure: true,
      largeResultOffload: true,
      compaction: { enabled: true, thresholdTokens: 48_000 },
    },
    approvals: { requiredFor: ["write", "delete"] },
    sandbox: { provider: "container", network: "allowlist", fileDownloads: false },
    storage: "jsonl",
  },
};
