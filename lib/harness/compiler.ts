import { HarnessSpecSchema, type HarnessSpec } from "@/lib/harness/schema";

export type HarnessBlueprint = {
  generatedAt: string;
  spec: HarnessSpec;
  enabledCapabilities: string[];
  enabledSkills: string[];
  runtimeContract: {
    disconnectSafe: boolean;
    replayable: boolean;
    runtimeEnforcedApprovals: boolean;
    progressiveDisclosure: boolean;
    parallelIsolation: boolean;
    sandboxedExecution: boolean;
  };
  security: {
    approvalRisks: HarnessSpec["runtime"]["approvals"]["requiredFor"];
    writeToolsWithoutApproval: string[];
    networkPolicy: HarnessSpec["runtime"]["sandbox"]["network"];
  };
};

export type TrueForgeManifest = {
  model: { name: string; params: { temperature: number; parallel_tool_calls: boolean } };
  instructions: string;
  mcp_servers: Array<{
    name: string;
    enable_tools: string[];
    disable_tools: string[];
    preload_tools: string[];
    require_approval_for_tools: string[];
    preload: boolean;
  }>;
  skills: Array<{ name: string }>;
  config: {
    iteration_limit: number;
    sandbox: { enabled: boolean; file_downloads: boolean };
    dynamic_sub_agents: { enabled: boolean };
    context_management: {
      compaction: {
        enabled: boolean;
        trigger?: { type: "input_tokens"; value: number };
      };
      large_tool_response: { enabled: boolean };
    };
    generative_ui: { enabled: boolean };
    ask_user_questions: { enabled: boolean };
  };
};

export function compileHarnessBlueprint(input: unknown, generatedAt = new Date().toISOString()): HarnessBlueprint {
  const spec = HarnessSpecSchema.parse(input);
  const approvalRisks = new Set(spec.runtime.approvals.requiredFor);
  const enabledTools = spec.tools.filter((tool) => tool.enabled);

  return {
    generatedAt,
    spec,
    enabledCapabilities: enabledTools.map((tool) => tool.name),
    enabledSkills: spec.skills.filter((skill) => skill.enabled).map((skill) => skill.name),
    runtimeContract: {
      disconnectSafe: false,
      replayable: true,
      runtimeEnforcedApprovals: enabledTools.some(
        (tool) => tool.name === "blueprint.write" && tool.risk === "write",
      ),
      progressiveDisclosure: false,
      parallelIsolation: false,
      sandboxedExecution: false,
    },
    security: {
      approvalRisks: spec.runtime.approvals.requiredFor,
      writeToolsWithoutApproval: enabledTools
        .filter((tool) => tool.risk !== "read" && !approvalRisks.has(tool.risk))
        .map((tool) => tool.name),
      networkPolicy: spec.runtime.sandbox.network,
    },
  };
}

export function toTrueForgeManifest(input: unknown): TrueForgeManifest {
  const spec = HarnessSpecSchema.parse(input);
  if (spec.runtime.sandbox.network !== "unrestricted") {
    throw new Error(
      `Harness network policy '${spec.runtime.sandbox.network}' cannot be represented because the TrueForge sandbox config has no network-policy field`,
    );
  }
  const tools = spec.tools.filter((tool) => tool.enabled);
  const approvalSelectors = spec.runtime.approvals.requiredFor.map((risk) => {
    if (risk === "delete") return "@destructive";
    if (risk === "write") return "@write";
    return "@all";
  });
  const compaction = spec.runtime.context.compaction.enabled
    ? {
        enabled: true,
        trigger: {
          type: "input_tokens" as const,
          value: spec.runtime.context.compaction.thresholdTokens,
        },
      }
    : { enabled: false };

  return {
    model: {
      name: spec.model.id,
      params: {
        temperature: spec.model.temperature,
        parallel_tool_calls: spec.runtime.subagents.enabled,
      },
    },
    instructions: [
      `You are ${spec.name}, operated by ${spec.organization}.`,
      spec.description,
      "Treat runtime approval gates as mandatory. Never claim an action completed unless its tool event confirms completion.",
    ].join("\n\n"),
    mcp_servers: [
      {
        name: `${spec.slug}-tools`,
        enable_tools: tools.map((tool) => tool.name),
        disable_tools: [],
        preload_tools: tools.filter((tool) => !tool.deferred).map((tool) => tool.name),
        require_approval_for_tools: [...new Set(approvalSelectors)],
        preload: !spec.runtime.context.progressiveDisclosure,
      },
    ],
    skills: spec.skills.filter((skill) => skill.enabled).map((skill) => ({ name: skill.name })),
    config: {
      iteration_limit: spec.runtime.maxIterations,
      sandbox: {
        enabled: spec.runtime.sandbox.provider !== "local",
        file_downloads: spec.runtime.sandbox.fileDownloads,
      },
      dynamic_sub_agents: { enabled: spec.runtime.subagents.enabled },
      context_management: {
        compaction,
        large_tool_response: { enabled: spec.runtime.context.largeResultOffload },
      },
      generative_ui: { enabled: true },
      ask_user_questions: { enabled: true },
    },
  };
}
