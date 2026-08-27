"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HarnessSpecSchema, type HarnessSpec, type ToolRisk } from "@/lib/harness/schema";

const iconPaths: Record<string, ReactNode> = {
  build: <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h5M8 17h7"/></>,
  runtime: <><path d="M5 4v16l14-8z"/><path d="M9 9.5v5l4.5-2.5z"/></>,
  policy: <><path d="M12 3l7 3v5c0 4.6-2.8 8-7 10-4.2-2-7-5.4-7-10V6z"/><path d="M9 12l2 2 4-4"/></>,
  deploy: <><path d="M12 3v12M8 7l4-4 4 4"/><rect x="4" y="15" width="16" height="6" rx="2"/></>,
  moon: <path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
  model: <><path d="M9 3h6l4 4v10l-4 4H9l-4-4V7z"/><circle cx="9" cy="11" r="1"/><circle cx="15" cy="11" r="1"/><path d="M9 16h6"/></>,
  tools: <><path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.5 2.5-3-3z"/></>,
  branch: <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 5h3a4 4 0 0 1 4 4v7M8 5v8a3 3 0 0 0 3 3h5"/></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
  spark: <path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"/>,
  shield: <><path d="M12 3l7 3v5c0 4.5-2.8 8-7 10-4.2-2-7-5.5-7-10V6z"/><path d="M12 8v5M12 16h.01"/></>,
  check: <path d="M20 6L9 17l-5-5"/>,
  research: <><circle cx="10" cy="10" r="6"/><path d="M15 15l5 5M8 8h4M10 6v4"/></>,
  code: <><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></>,
  incident: <><path d="M12 3L2.7 20h18.6z"/><path d="M12 9v4M12 17h.01"/></>,
};

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {iconPaths[name] ?? iconPaths.spark}
    </svg>
  );
}

type StudioTab = "build" | "runtime" | "policy" | "deploy";
type RunStatus = "idle" | "running" | "waiting_for_approval" | "completed" | "failed";
export type StreamEvent = {
  id: string;
  runId: string;
  sequence: number;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePublicStreamEvent(data: string, expectedRunId: string): StreamEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(value) || !isRecord(value.payload)) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  if (value.runId !== expectedRunId) return null;
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) return null;
  if (typeof value.type !== "string" || value.type.length === 0) return null;
  if (typeof value.timestamp !== "string" || value.timestamp.length === 0) return null;
  return value as StreamEvent;
}

export function createRunGenerationGuard() {
  let current = 0;
  return {
    begin() {
      current += 1;
      return current;
    },
    isCurrent(generation: number) {
      return generation === current;
    },
    invalidate() {
      current += 1;
    },
  };
}

export function createSingleFlightGuard() {
  let active = false;
  return {
    tryStart() {
      if (active) return false;
      active = true;
      return true;
    },
    finish() {
      active = false;
    },
  };
}

type RunResponse = { id: string; status: RunStatus; pendingApprovalId?: string | null };
type StreamConnection = { source: EventSource; close: () => void };

type TemplateId = "incident" | "research" | "code";

export const HARNESS_STREAM_ERROR_MESSAGE = "Event stream failed. Start a new run to retry.";
export const HARNESS_STREAM_RECONNECT_MESSAGE = "Stream reconnecting. Persisted events will replay automatically.";
export const TRUEFORGE_EXPORT_GUIDANCE = "Call toTrueForgeManifest from lib/harness/compiler.ts to generate a TrueForge manifest.";

type ClipboardWriter = { writeText: (text: string) => Promise<void> };

export async function writeClipboardText(
  text: string,
  clipboard: ClipboardWriter | undefined = typeof navigator === "undefined" ? undefined : navigator.clipboard,
): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const templates: Array<{ id: TemplateId; title: string; copy: string }> = [
  { id: "incident", title: "Incident operations", copy: "Governed triage and escalation" },
  { id: "research", title: "Research intelligence", copy: "Parallel source investigation" },
  { id: "code", title: "Codebase engineering", copy: "Sandboxed changes with review" },
];

const tabItems: Array<{ id: StudioTab; label: string; icon: string }> = [
  { id: "build", label: "Composition", icon: "build" },
  { id: "runtime", label: "Runtime", icon: "runtime" },
  { id: "policy", label: "Policies", icon: "policy" },
  { id: "deploy", label: "Deploy", icon: "deploy" },
];

function updateRuntime(spec: HarnessSpec, runtime: HarnessSpec["runtime"]): HarnessSpec {
  return { ...spec, runtime };
}

function applyTemplate(current: HarnessSpec, id: TemplateId): HarnessSpec {
  if (id === "research") {
    return {
      ...current,
      name: "Research Intelligence Harness",
      slug: "research-intelligence",
      description: "A durable research agent that discovers tools lazily, fans work out, and returns a cited synthesis.",
      tools: [
        { name: "catalog.discover", description: "Discover approved research capabilities without loading every schema.", risk: "read", enabled: true, deferred: false },
        { name: "web.search", description: "Search allowlisted public sources and return structured evidence.", risk: "read", enabled: true, deferred: true },
        { name: "artifact.write", description: "Persist the final cited brief as a reviewable artifact.", risk: "write", enabled: true, deferred: true },
      ],
      skills: [
        { name: "source-research", description: "Evidence-first web research with source fidelity requirements.", source: "git", enabled: true },
        { name: "brief-builder", description: "Compiles findings into a concise cited organizational brief.", source: "inline", enabled: true },
      ],
    };
  }
  if (id === "code") {
    return {
      ...current,
      name: "Codebase Engineering Harness",
      slug: "codebase-engineering",
      description: "A sandboxed coding agent that inspects repositories, proposes diffs, verifies changes, and waits before writes.",
      tools: [
        { name: "repository.read", description: "Read allowlisted repository files and metadata inside the sandbox.", risk: "read", enabled: true, deferred: false },
        { name: "tests.run", description: "Execute configured test commands inside an isolated workspace.", risk: "read", enabled: true, deferred: true },
        { name: "patch.write", description: "Apply an approved patch to the isolated working tree.", risk: "write", enabled: true, deferred: true },
      ],
      skills: [
        { name: "test-driven-development", description: "Requires a failing test before implementing behavior changes.", source: "git", enabled: true },
        { name: "code-review", description: "Checks correctness, security, and maintainability before delivery.", source: "inline", enabled: true },
      ],
    };
  }
  return {
    ...current,
    name: "Incident Triage Harness",
    slug: "incident-triage",
    description: "A durable incident-response agent with governed tools, parallel specialists, and replayable execution.",
    tools: [
      { name: "catalog.discover", description: "Discover approved organizational capabilities without loading every schema.", risk: "read", enabled: true, deferred: false },
      { name: "context.audit", description: "Inspect the active context budget and recommend compaction or offloading.", risk: "read", enabled: true, deferred: true },
      { name: "blueprint.write", description: "Persist a generated organizational harness blueprint as a reviewable artifact.", risk: "write", enabled: true, deferred: true },
    ],
    skills: [
      { name: "incident-triage", description: "A procedure for evidence-first incident classification and escalation.", source: "inline", enabled: true },
      { name: "postmortem-builder", description: "Turns the final event trace into a structured postmortem outline.", source: "git", enabled: true },
    ],
  };
}

function eventTone(type: string) {
  if (type.includes("approval")) return "orange";
  if (type.includes("subagent")) return "violet";
  if (type.includes("completed") || type.includes("artifact")) return "green";
  if (type.includes("started") || type.includes("tool")) return "accent";
  return "neutral";
}

function eventSummary(event: StreamEvent) {
  const value = event.payload.summary ?? event.payload.label ?? event.payload.message ?? event.payload.tool ?? event.payload.worker;
  if (typeof value === "string") return value;
  const entries = Object.entries(event.payload).filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean");
  if (entries.length === 0) return "Runtime checkpoint recorded.";
  return entries.slice(0, 3).map(([key, item]) => `${key}: ${String(item)}`).join(" · ");
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function approvalPresentation(payload: Record<string, unknown>) {
  const tool = nonEmptyString(payload.tool) ?? "requested action";
  const risk = nonEmptyString(payload.risk) ?? "unspecified";
  const summary = nonEmptyString(payload.summary) ?? `${tool} is waiting for approval.`;
  return {
    title: `Allow ${tool}?`,
    copy: `${summary} Risk: ${risk}. This checkpoint is enforced by the runtime, outside the model.`,
  };
}

function ToggleRow({ title, description, value, onChange }: { title: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="toggle-row">
      <button type="button" className="toggle" data-on={value} aria-pressed={value} aria-label={title} onClick={() => onChange(!value)} />
      <div className="toggle-copy"><div className="toggle-title">{title}</div><div className="toggle-description">{description}</div></div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}</label>;
}

function BuilderPanel({ tab, spec, setSpec }: { tab: StudioTab; spec: HarnessSpec; setSpec: (spec: HarnessSpec) => void }) {
  const toggleTool = (name: string) => setSpec({ ...spec, tools: spec.tools.map((tool) => tool.name === name ? { ...tool, enabled: !tool.enabled } : tool) });
  const addTool = () => {
    const ordinal = spec.tools.length + 1;
    setSpec({ ...spec, tools: [...spec.tools, { name: `custom.tool-${ordinal}`, description: "Describe the organizational capability and its side effects.", risk: "read", enabled: true, deferred: true }] });
  };
  const addSkill = () => {
    const ordinal = spec.skills.length + 1;
    setSpec({ ...spec, skills: [...spec.skills, { name: `organization-skill-${ordinal}`, description: "Describe the procedure this skill contributes to the harness.", source: "inline", enabled: true }] });
  };
  const toggleApproval = (risk: ToolRisk) => {
    const required = spec.runtime.approvals.requiredFor.includes(risk);
    const requiredFor = required
      ? spec.runtime.approvals.requiredFor.filter((item) => item !== risk)
      : [...spec.runtime.approvals.requiredFor, risk];
    setSpec(updateRuntime(spec, { ...spec.runtime, approvals: { requiredFor } }));
  };

  if (tab === "runtime") {
    return (
      <>
        <div className="form-section">
          <div className="form-heading">Long-running execution <span className="chip">runtime</span></div>
          <ToggleRow title="Durable sessions" description="Run independently from the browser connection." value={spec.runtime.durableSessions} onChange={(value) => setSpec(updateRuntime(spec, { ...spec.runtime, durableSessions: value }))} />
          <ToggleRow title="Dynamic subagents" description="Isolate parallel work in independent contexts." value={spec.runtime.subagents.enabled} onChange={(value) => setSpec(updateRuntime(spec, { ...spec.runtime, subagents: { ...spec.runtime.subagents, enabled: value } }))} />
          <Field label="Parallel workers"><input className="field-input" type="number" min={1} max={16} value={spec.runtime.subagents.maxParallel} onChange={(event) => setSpec(updateRuntime(spec, { ...spec.runtime, subagents: { ...spec.runtime.subagents, maxParallel: Number(event.target.value) } }))} /></Field>
          <Field label="Iteration limit"><input className="field-input" type="number" min={1} max={200} value={spec.runtime.maxIterations} onChange={(event) => setSpec(updateRuntime(spec, { ...spec.runtime, maxIterations: Number(event.target.value) }))} /></Field>
        </div>
        <div className="form-section">
          <div className="form-heading">Context engineering</div>
          <ToggleRow title="Progressive disclosure" description="Load full tool schemas only when needed." value={spec.runtime.context.progressiveDisclosure} onChange={(value) => setSpec(updateRuntime(spec, { ...spec.runtime, context: { ...spec.runtime.context, progressiveDisclosure: value } }))} />
          <ToggleRow title="Large-result offload" description="Store heavy results as artifacts instead of prompt history." value={spec.runtime.context.largeResultOffload} onChange={(value) => setSpec(updateRuntime(spec, { ...spec.runtime, context: { ...spec.runtime.context, largeResultOffload: value } }))} />
          <ToggleRow title="Automatic compaction" description="Summarize old events after the token threshold." value={spec.runtime.context.compaction.enabled} onChange={(value) => setSpec(updateRuntime(spec, { ...spec.runtime, context: { ...spec.runtime.context, compaction: { ...spec.runtime.context.compaction, enabled: value } } }))} />
          <Field label="Compaction threshold"><input className="field-input" type="number" step={1000} min={1000} value={spec.runtime.context.compaction.thresholdTokens} onChange={(event) => setSpec(updateRuntime(spec, { ...spec.runtime, context: { ...spec.runtime.context, compaction: { ...spec.runtime.context.compaction, thresholdTokens: Number(event.target.value) } } }))} /></Field>
        </div>
      </>
    );
  }

  if (tab === "policy") {
    return (
      <>
        <div className="form-section">
          <div className="form-heading">Runtime approval gates <span className="chip"><span className="chip-dot" /> enforced</span></div>
          {(["read", "write", "delete"] as ToolRisk[]).map((risk) => (
            <ToggleRow key={risk} title={`Require approval for ${risk}`} description={risk === "read" ? "Usually unnecessary for allowlisted sources." : "The model cannot bypass this runtime rule."} value={spec.runtime.approvals.requiredFor.includes(risk)} onChange={() => toggleApproval(risk)} />
          ))}
        </div>
        <div className="form-section">
          <div className="form-heading">Execution boundary</div>
          <Field label="Sandbox provider"><select className="field-select" value={spec.runtime.sandbox.provider} onChange={(event) => setSpec(updateRuntime(spec, { ...spec.runtime, sandbox: { ...spec.runtime.sandbox, provider: event.target.value as HarnessSpec["runtime"]["sandbox"]["provider"] } }))}><option value="local">Local process</option><option value="container">Container</option><option value="daytona">Daytona</option></select></Field>
          <Field label="Network policy"><select className="field-select" value={spec.runtime.sandbox.network} onChange={(event) => setSpec(updateRuntime(spec, { ...spec.runtime, sandbox: { ...spec.runtime.sandbox, network: event.target.value as HarnessSpec["runtime"]["sandbox"]["network"] } }))}><option value="none">No network</option><option value="allowlist">Allowlist only</option><option value="unrestricted">Unrestricted</option></select></Field>
        </div>
        <div className="form-section">
          <div className="form-heading">Capability risk</div>
          {spec.tools.map((tool) => <div className="toggle-row" key={tool.name}><div className="chip">{tool.risk}</div><div className="toggle-copy"><div className="toggle-title">{tool.name}</div><div className="toggle-description">{tool.description}</div></div></div>)}
        </div>
      </>
    );
  }

  if (tab === "deploy") {
    return (
      <>
        <div className="form-section">
          <div className="form-heading">Persistence</div>
          <Field label="Event store"><select className="field-select" value={spec.runtime.storage} onChange={(event) => setSpec(updateRuntime(spec, { ...spec.runtime, storage: event.target.value as HarnessSpec["runtime"]["storage"] }))}><option value="jsonl">JSONL starter</option><option value="sqlite">SQLite</option><option value="postgres">Postgres</option></select></Field>
          <Field label="Event retention days"><input className="field-input" type="number" min={1} max={3650} value={spec.runtime.eventRetentionDays} onChange={(event) => setSpec(updateRuntime(spec, { ...spec.runtime, eventRetentionDays: Number(event.target.value) }))} /></Field>
        </div>
        <div className="form-section">
          <div className="form-heading">Deployment contract</div>
          <div className="toggle-row"><span className="chip"><span className="chip-dot"/> node ≥22</span><div className="toggle-copy"><div className="toggle-title">Single-node starter</div><div className="toggle-description">JSONL is fully functional locally. Swap the store adapter for multi-replica production.</div></div></div>
          <div className="toggle-row"><span className="chip">SSE</span><div className="toggle-copy"><div className="toggle-title">Resumable event client</div><div className="toggle-description">Clients replay events by sequence after reconnecting.</div></div></div>
          <div className="toggle-row"><span className="chip">BYO</span><div className="toggle-copy"><div className="toggle-title">Vendor-neutral manifest</div><div className="toggle-description">Export portable JSON and a TrueForge-compatible manifest.</div></div></div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="form-section">
        <div className="form-heading">Agent identity <span className="chip">v{spec.version}</span></div>
        <Field label="Name"><input className="field-input" value={spec.name} onChange={(event) => setSpec({ ...spec, name: event.target.value })} /></Field>
        <Field label="Slug"><input className="field-input" value={spec.slug} onChange={(event) => setSpec({ ...spec, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></Field>
        <Field label="Organization"><input className="field-input" value={spec.organization} onChange={(event) => setSpec({ ...spec, organization: event.target.value })} /></Field>
        <Field label="Purpose"><input className="field-input" value={spec.description} onChange={(event) => setSpec({ ...spec, description: event.target.value })} /></Field>
      </div>
      <div className="form-section">
        <div className="form-heading">Target model adapter <span className="chip">export</span></div>
        <Field label="Provider"><select className="field-select" value={spec.model.provider} onChange={(event) => setSpec({ ...spec, model: { ...spec.model, provider: event.target.value as HarnessSpec["model"]["provider"] } })}><option value="runbook">Deterministic runbook</option><option value="openai-compatible">OpenAI compatible</option><option value="anthropic">Anthropic</option><option value="azure-openai">Azure OpenAI</option><option value="ollama">Ollama</option></select></Field>
        <Field label="Model ID"><input className="field-input" value={spec.model.id} onChange={(event) => setSpec({ ...spec, model: { ...spec.model, id: event.target.value } })} /></Field>
      </div>
      <div className="form-section">
        <div className="form-heading">Capabilities <button className="btn btn-ghost mini-action" type="button" onClick={addTool}>+ Add tool</button></div>
        {spec.tools.map((tool, index) => (
          <div className="capability-editor" key={`${index}-${tool.name}`}>
            <div className="capability-top">
              <button type="button" className="toggle" data-on={tool.enabled} aria-pressed={tool.enabled} aria-label={`Enable ${tool.name}`} onClick={() => toggleTool(tool.name)} />
              <input aria-label="Tool name" className="capability-name" value={tool.name} onChange={(event) => setSpec({ ...spec, tools: spec.tools.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} />
              <button className="remove-action" type="button" aria-label={`Remove ${tool.name}`} onClick={() => setSpec({ ...spec, tools: spec.tools.filter((_, itemIndex) => itemIndex !== index) })}>×</button>
            </div>
            <input aria-label={`Description for ${tool.name}`} className="capability-description" value={tool.description} onChange={(event) => setSpec({ ...spec, tools: spec.tools.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) })} />
            <div className="capability-options">
              <select aria-label={`Risk for ${tool.name}`} className="compact-select" value={tool.risk} onChange={(event) => setSpec({ ...spec, tools: spec.tools.map((item, itemIndex) => itemIndex === index ? { ...item, risk: event.target.value as ToolRisk } : item) })}><option value="read">read</option><option value="write">write</option><option value="delete">delete</option></select>
              <button className="chip" type="button" onClick={() => setSpec({ ...spec, tools: spec.tools.map((item, itemIndex) => itemIndex === index ? { ...item, deferred: !item.deferred } : item) })}>{tool.deferred ? "deferred" : "preloaded"}</button>
            </div>
          </div>
        ))}
      </div>
      <div className="form-section">
        <div className="form-heading">Skills <button className="btn btn-ghost mini-action" type="button" onClick={addSkill}>+ Add skill</button></div>
        {spec.skills.map((skill, index) => (
          <div className="capability-editor" key={`${index}-${skill.name}`}>
            <div className="capability-top">
              <button type="button" className="toggle" data-on={skill.enabled} aria-pressed={skill.enabled} aria-label={`Enable ${skill.name}`} onClick={() => setSpec({ ...spec, skills: spec.skills.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: !item.enabled } : item) })} />
              <input aria-label="Skill name" className="capability-name" value={skill.name} onChange={(event) => setSpec({ ...spec, skills: spec.skills.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} />
              <button className="remove-action" type="button" aria-label={`Remove ${skill.name}`} onClick={() => setSpec({ ...spec, skills: spec.skills.filter((_, itemIndex) => itemIndex !== index) })}>×</button>
            </div>
            <div className="capability-options"><select aria-label={`Source for ${skill.name}`} className="compact-select" value={skill.source} onChange={(event) => setSpec({ ...spec, skills: spec.skills.map((item, itemIndex) => itemIndex === index ? { ...item, source: event.target.value as HarnessSpec["skills"][number]["source"] } : item) })}><option value="inline">inline</option><option value="git">git</option><option value="registry">registry</option></select></div>
          </div>
        ))}
      </div>
    </>
  );
}

function Architecture({ spec, valid }: { spec: HarnessSpec; valid: boolean }) {
  const enabledTools = spec.tools.filter((tool) => tool.enabled);
  const enabledSkills = spec.skills.filter((skill) => skill.enabled);
  return (
    <div className="architecture-card">
      <div className="arch-header"><div><div className="arch-title">Live harness topology</div><div className="arch-meta">{spec.slug}.harness.json</div></div><span className="status-pill" data-status={valid ? "completed" : "failed"}><span className="status-dot"/>{valid ? "valid spec" : "fix spec"}</span></div>
      <div className="arch-body">
        <div className="flow">
          <div className="flow-col">
            <div className="node"><span className="node-indicator"/><div className="node-title">Model adapter</div><div className="node-sub">{spec.model.provider}<br/>{spec.model.id}</div></div>
            <div className="node"><span className="node-indicator"/><div className="node-title">Capability catalog</div><div className="node-sub">{enabledTools.length} tools · progressive disclosure</div></div>
          </div>
          <div className="flow-arrow" />
          <div className="flow-col">
            <div className="node node-accent"><span className="node-indicator"/><div className="node-title">Durable execution loop</div><div className="node-sub">The reliability layer around the model.</div><div className="node-chips"><span className="chip">≤ {spec.runtime.maxIterations} turns</span><span className="chip">SSE replay</span><span className="chip">HITL</span></div></div>
            <div className="node"><span className="node-indicator"/><div className="node-title">Isolated workers</div><div className="node-sub">{spec.runtime.subagents.enabled ? `${spec.runtime.subagents.maxParallel} parallel contexts` : "disabled"}</div><div className="node-chips">{enabledSkills.map((skill) => <span className="chip" key={skill.name}>{skill.name}</span>)}</div></div>
          </div>
          <div className="flow-arrow" />
          <div className="flow-col">
            <div className="node"><span className="node-indicator"/><div className="node-title">Policy gate</div><div className="node-sub">Runtime enforced · not a prompt instruction</div><div className="node-chips">{spec.runtime.approvals.requiredFor.map((risk) => <span className="chip" key={risk}>{risk}</span>)}</div></div>
            <div className="node"><span className="node-indicator"/><div className="node-title">Event + artifact store</div><div className="node-sub">{spec.runtime.storage} · {spec.runtime.eventRetentionDays} day retention</div></div>
          </div>
        </div>
        <div className="reliability-strip">
          {[
            ["Disconnect", spec.runtime.durableSessions ? "survives" : "coupled"],
            ["Context", spec.runtime.context.compaction.enabled ? `${Math.round(spec.runtime.context.compaction.thresholdTokens / 1000)}k compact` : "unbounded"],
            ["Sandbox", spec.runtime.sandbox.provider],
            ["Network", spec.runtime.sandbox.network],
          ].map(([label, value]) => <div className="reliability-item" key={label}><div className="reliability-label">{label}</div><div className="reliability-value"><span className="chip-dot"/>{value}</div></div>)}
        </div>
      </div>
    </div>
  );
}

function RuntimeRail({ spec, valid, validationMessage, requestExport }: { spec: HarnessSpec; valid: boolean; validationMessage: string | null; requestExport: () => void }) {
  const [prompt, setPrompt] = useState("Create a production-ready incident harness for our operations team.");
  const [run, setRun] = useState<RunResponse | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  const statusRef = useRef<RunStatus>("idle");
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const sourceRef = useRef<StreamConnection | null>(null);
  const startAbortRef = useRef<AbortController | null>(null);
  const generationGuardRef = useRef(createRunGenerationGuard());
  const approvalGuardRef = useRef(createSingleFlightGuard());

  const updateStatus = (next: RunStatus) => {
    statusRef.current = next;
    setStatus(next);
  };

  useEffect(() => () => {
    generationGuardRef.current.invalidate();
    startAbortRef.current?.abort();
    startAbortRef.current = null;
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const pending = [...events].reverse().find((event) => event.type === "approval.required" && !events.some((candidate) => candidate.type === "approval.resolved" && candidate.payload.approvalId === event.payload.approvalId));
  const approval = pending ? approvalPresentation(pending.payload) : null;

  const connect = (runId: string, generation: number) => {
    if (!generationGuardRef.current.isCurrent(generation)) return;
    sourceRef.current?.close();
    const source = new EventSource(`/api/runs/${runId}/events`);

    const isCurrentConnection = () => generationGuardRef.current.isCurrent(generation) && sourceRef.current?.source === source;
    function closeConnection() {
      source.onopen = null;
      source.onmessage = null;
      source.onerror = null;
      source.removeEventListener("harness-error", onHarnessError);
      source.close();
      if (sourceRef.current?.source === source) sourceRef.current = null;
    }
    function onHarnessError() {
      if (!isCurrentConnection()) return;
      updateStatus("failed");
      setError(HARNESS_STREAM_ERROR_MESSAGE);
      closeConnection();
    }

    sourceRef.current = { source, close: closeConnection };
    source.onopen = () => {
      if (!isCurrentConnection()) return;
      setError((current) => current === HARNESS_STREAM_RECONNECT_MESSAGE ? null : current);
    };
    source.onmessage = (message) => {
      if (!isCurrentConnection()) return;
      const event = parsePublicStreamEvent(message.data, runId);
      if (!event) return;
      setEvents((current) => {
        if (!generationGuardRef.current.isCurrent(generation) || sourceRef.current?.source !== source) return current;
        return current.some((item) => item.id === event.id) ? current : [...current, event];
      });
      if (event.type === "approval.required") updateStatus("waiting_for_approval");
      if (event.type === "approval.resolved") updateStatus("running");
      if (event.type === "run.completed") { updateStatus("completed"); closeConnection(); }
      if (event.type === "run.failed") { updateStatus("failed"); closeConnection(); }
    };
    source.onerror = () => {
      if (!isCurrentConnection()) return;
      if (statusRef.current !== "completed" && statusRef.current !== "failed") setError(HARNESS_STREAM_RECONNECT_MESSAGE);
    };
    source.addEventListener("harness-error", onHarnessError);
  };

  const startRun = async () => {
    const generation = generationGuardRef.current.begin();
    startAbortRef.current?.abort();
    const startController = new AbortController();
    startAbortRef.current = startController;
    sourceRef.current?.close();
    sourceRef.current = null;
    setRun(null); setError(null); setEvents([]); updateStatus("running");
    try {
      const response = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, spec }), signal: startController.signal });
      const body = await response.json() as { data?: RunResponse; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error ?? "Could not start the run");
      if (!generationGuardRef.current.isCurrent(generation)) return;
      setRun(body.data); connect(body.data.id, generation);
    } catch (caught) {
      if (!generationGuardRef.current.isCurrent(generation)) return;
      updateStatus("failed"); setError(caught instanceof Error ? caught.message : "Could not start the run");
    } finally {
      if (startAbortRef.current === startController) startAbortRef.current = null;
    }
  };

  const resolveApproval = async (decision: "allow" | "deny") => {
    if (!run || !pending || typeof pending.payload.approvalId !== "string") return;
    if (!approvalGuardRef.current.tryStart()) return;
    setApprovalSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${run.id}/approvals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approvalId: pending.payload.approvalId, decision }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? "Approval could not be resolved");
      } else {
        updateStatus("running");
      }
    } catch {
      setError("Approval request failed. Check the connection and retry.");
    } finally {
      approvalGuardRef.current.finish();
      setApprovalSubmitting(false);
    }
  };

  const copyRunId = async () => {
    if (!run) return;
    const copied = await writeClipboardText(run.id);
    if (!copied) setError("Run ID could not be copied. Check clipboard permission and retry.");
  };

  const subagents = events.filter((event) => event.type === "subagent.completed").length;
  const tools = events.filter((event) => event.type === "tool.completed").length;

  return (
    <div className="runtime-shell">
      <div className="runtime-head"><div><div className="eyebrow">Live execution</div><div className="runtime-title">Replayable event stream</div></div><span className="status-pill" data-status={status}><span className="status-dot"/>{status.replaceAll("_", " ")}</span></div>
      <div className="runtime-scroll">
        <div className="prompt-shell">
          <textarea aria-label="Run prompt" className="prompt-input" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <div className="prompt-actions"><span className="prompt-hint">Local conformance runbook</span><button className="btn btn-primary" type="button" onClick={startRun} disabled={!valid || !prompt.trim() || status === "running" || status === "waiting_for_approval"}><Icon name="runtime" size={13}/>{status === "idle" || status === "completed" || status === "failed" ? "Run" : "Running"}</button></div>
        </div>
        {!valid && <div className="approval-card"><div className="approval-kicker">spec validation</div><div className="approval-copy">{validationMessage ?? "Fix the harness spec before starting a run."}</div></div>}
        <div className="metrics"><div className="metric"><div className="metric-value">{events.length}</div><div className="metric-label">events</div></div><div className="metric"><div className="metric-value">{subagents}</div><div className="metric-label">workers</div></div><div className="metric"><div className="metric-value">{tools}</div><div className="metric-label">tools</div></div></div>
        {error && <div className="approval-card"><div className="approval-kicker">stream notice</div><div className="approval-copy">{error}</div></div>}
        {pending && approval && status === "waiting_for_approval" && (
          <div className="approval-card"><div className="approval-kicker"><Icon name="shield" size={12}/>runtime checkpoint</div><div className="approval-title">{approval.title}</div><div className="approval-copy">{approval.copy}</div><div className="event-detail">{JSON.stringify(pending.payload, null, 2)}</div><div className="approval-actions"><button className="btn btn-danger" type="button" disabled={approvalSubmitting} onClick={() => resolveApproval("deny")}>Deny</button><button className="btn btn-primary" type="button" disabled={approvalSubmitting} onClick={() => resolveApproval("allow")}><Icon name="check" size={13}/>{approvalSubmitting ? "Resolving…" : "Allow once"}</button></div></div>
        )}
        {events.length === 0 ? <div className="empty-events">Run the harness to watch persisted events, parallel workers, an approval pause, and artifact creation.</div> : <div className="event-list">{events.map((event) => <div className="event" data-tone={eventTone(event.type)} key={event.id}><div className="event-top"><div className="event-type">{event.type}</div><div className="event-seq">#{String(event.sequence).padStart(2, "0")}</div></div><div className="event-summary">{eventSummary(event)}</div></div>)}</div>}
        <div className="runtime-footer"><button className="btn" type="button" onClick={requestExport}><Icon name="download" size={13}/>Export config</button>{run && <button className="btn btn-ghost" type="button" onClick={copyRunId}>Copy run ID</button>}</div>
      </div>
    </div>
  );
}

export default function HarnessStudio({ initialSpec }: { initialSpec: HarnessSpec }) {
  const [spec, setSpec] = useState(initialSpec);
  const [tab, setTab] = useState<StudioTab>("build");
  const [template, setTemplate] = useState<TemplateId>("incident");
  const [toast, setToast] = useState<string | null>(null);
  const enabledCount = spec.tools.filter((tool) => tool.enabled).length + spec.skills.filter((skill) => skill.enabled).length;
  const validation = HarnessSpecSchema.safeParse(spec);
  const valid = validation.success;
  const validationMessage = validation.success ? null : validation.error.issues[0]?.message ?? "Invalid harness spec";

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  const exportPayload = useMemo(() => ({
    portable_spec: spec,
    export_targets: {
      trueforge: TRUEFORGE_EXPORT_GUIDANCE,
      standalone: "Use the built-in event runtime and replace the adapter/store ports for production.",
    },
  }), [spec]);

  const downloadSpec = () => {
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${spec.slug}.harness.json`; anchor.click();
    URL.revokeObjectURL(url); setToast("Harness spec downloaded");
  };

  const copySpec = async () => {
    const copied = await writeClipboardText(JSON.stringify(exportPayload, null, 2));
    setToast(copied ? "Spec copied to clipboard" : "Clipboard unavailable — download the spec instead");
  };
  const toggleTheme = () => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("oh-theme", next);
  };

  return (
    <main className="app-shell">
      <aside className="left-rail">
        <div className="workspace-switcher"><div><div className="workspace-name">Harness Studio</div><div className="workspace-meta">{spec.organization}</div></div><span className="workspace-version">v{spec.version}</span></div>
        <div className="rail-scroll"><nav className="rail-nav" aria-label="Builder sections">{tabItems.map((item) => <button className="nav-item" data-active={tab === item.id} type="button" key={item.id} onClick={() => setTab(item.id)}><span className="nav-icon"><Icon name={item.icon}/></span><span>{item.label}</span></button>)}</nav><BuilderPanel tab={tab} spec={spec} setSpec={setSpec}/></div>
        <div className="sidebar-footer"><span><span className="chip-dot"/>local conformance</span><button className="sidebar-theme" type="button" onClick={toggleTheme} aria-label="Toggle theme"><span className="theme-icon theme-icon-dark"><Icon name="sun" size={14}/></span><span className="theme-icon theme-icon-light"><Icon name="moon" size={14}/></span></button></div>
      </aside>
      <section className="workspace-shell">
        <div className="workspace-grid">
          <section className="canvas-window">
            <header className="window-bar"><div className="document-tab"><span className="document-dot"/>{spec.name}</div><div className="top-actions"><span className="status-pill" data-status="completed"><span className="status-dot"/>{enabledCount} capabilities</span><button className="btn btn-ghost" type="button" onClick={copySpec}><Icon name="copy" size={13}/>Copy</button><button className="btn" type="button" onClick={downloadSpec}><Icon name="download" size={13}/>Export</button></div></header>
            <div className="canvas-scroll">
              <div className="canvas-inner"><div className="eyebrow"><span className="eyebrow-dot"/>portable harness composition</div><h1 className="section-title">{spec.name}</h1><p className="section-copy">{spec.description} Configure the runtime, then exercise the same durable event, approval, worker, and artifact boundaries locally.</p>
                <div className="template-label">Start from a pattern</div><div className="template-row">{templates.map((item) => <button className="template-card" data-active={template === item.id} type="button" key={item.id} onClick={() => { setTemplate(item.id); setSpec(applyTemplate(spec, item.id)); setToast(`${item.title} template loaded`); }}><span className="template-radio"/><span><span className="template-title">{item.title}</span><span className="template-copy">{item.copy}</span></span></button>)}</div>
                <Architecture spec={spec} valid={valid}/>
              </div>
            </div>
          </section>
          <aside className="runtime-window"><RuntimeRail spec={spec} valid={valid} validationMessage={validationMessage} requestExport={downloadSpec}/></aside>
        </div>
      </section>
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
