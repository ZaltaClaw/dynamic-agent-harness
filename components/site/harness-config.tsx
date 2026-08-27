"use client";

import { useState, type ReactNode } from "react";
import type { HarnessSpec, ToolRisk } from "@/lib/harness/schema";

export type TemplateId = "incident" | "research" | "code";

type HarnessConfigProps = {
  spec: HarnessSpec;
  valid: boolean;
  validationMessage: string | null;
  onChange: (spec: HarnessSpec) => void;
  onClose: () => void;
  onCopy: () => void;
  onExport: () => void;
};

const templates: Array<{ id: TemplateId; title: string; copy: string }> = [
  { id: "incident", title: "Incident operations", copy: "Governed triage and escalation" },
  { id: "research", title: "Research intelligence", copy: "Parallel source investigation" },
  { id: "code", title: "Codebase engineering", copy: "Sandboxed changes with review" },
];

export function applyHarnessTemplate(current: HarnessSpec, id: TemplateId): HarnessSpec {
  if (id === "research") {
    return {
      ...current,
      name: "Research Intelligence Harness",
      slug: "research-intelligence",
      description: "A durable research agent that discovers approved capabilities, fans work out, and returns a reviewable synthesis.",
      tools: [
        { name: "catalog.discover", description: "Discover approved research capabilities without loading every schema.", risk: "read", enabled: true, deferred: false },
        { name: "web.search", description: "Search allowlisted public sources and return structured evidence.", risk: "read", enabled: true, deferred: true },
        { name: "blueprint.write", description: "Persist the final cited brief as a reviewable harness artifact.", risk: "write", enabled: true, deferred: true },
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
        { name: "blueprint.write", description: "Persist an approved implementation blueprint as a reviewable artifact.", risk: "write", enabled: true, deferred: true },
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

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} onClick={onClick} className="flex size-7 items-center justify-center rounded-[7px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink">{children}</button>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="mt-3 grid gap-1.5"><span className="text-[9.5px] font-semibold tracking-[0.06em] text-ink-3 uppercase">{label}</span>{children}</label>;
}

function Toggle({ title, description, value, onChange }: { title: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <button type="button" role="switch" aria-checked={value} aria-label={title} onClick={() => onChange(!value)} className={`relative mt-0.5 h-[18px] w-[30px] shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--line-strong)] transition-colors duration-150 ${value ? "bg-accent" : "bg-hover-2"}`}>
        <span className="absolute top-[3px] left-[3px] size-3 rounded-full bg-white shadow-btn transition-transform duration-150" style={{ transform: value ? "translateX(12px)" : "translateX(0)", transitionTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }} />
      </button>
      <span className="min-w-0"><span className="block text-[12.5px] font-medium text-ink">{title}</span><span className="mt-0.5 block text-[10.5px] leading-relaxed text-ink-3">{description}</span></span>
    </div>
  );
}

const inputClass = "h-9 w-full rounded-control border border-line-strong bg-surface px-2.5 text-[12px] text-ink shadow-inset-field outline-none transition-[border-color,box-shadow] focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-tint)]";
const textareaClass = "min-h-20 w-full resize-y rounded-control border border-line-strong bg-surface px-2.5 py-2 text-[12px] leading-relaxed text-ink shadow-inset-field outline-none transition-[border-color,box-shadow] focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-tint)]";

export default function HarnessConfig({ spec, valid, validationMessage, onChange, onClose, onCopy, onExport }: HarnessConfigProps) {
  const [tab, setTab] = useState<"identity" | "runtime" | "capabilities">("identity");
  const updateRuntime = (runtime: HarnessSpec["runtime"]) => onChange({ ...spec, runtime });
  const updateApproval = (risk: ToolRisk) => {
    const current = spec.runtime.approvals.requiredFor;
    const requiredFor = current.includes(risk) ? current.filter((item) => item !== risk) : [...current, risk];
    updateRuntime({ ...spec.runtime, approvals: { requiredFor } });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3 pl-4">
        <div><div className="text-[13px] font-semibold text-ink">Harness configuration</div><div className="text-[9.5px] text-ink-3">{valid ? "Valid portable spec" : validationMessage}</div></div>
        <IconButton label="Close configuration" onClick={onClose}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12"/></svg></IconButton>
      </header>

      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        {(["identity", "runtime", "capabilities"] as const).map((item) => (
          <button key={item} type="button" aria-pressed={tab === item} onClick={() => setTab(item)} className={`h-7 rounded-[7px] px-2.5 text-[11.5px] font-medium capitalize transition-colors duration-100 ${tab === item ? "bg-hover-2 text-ink" : "text-ink-3 hover:bg-hover hover:text-ink"}`}>{item}</button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "identity" && (
          <>
            <div className="text-[11px] font-semibold text-ink">Start from a pattern</div>
            <div className="mt-2 grid gap-1">
              {templates.map((template) => (
                <button key={template.id} type="button" onClick={() => onChange(applyHarnessTemplate(spec, template.id))} className="rounded-control px-2.5 py-2 text-left transition-colors duration-100 hover:bg-hover">
                  <span className="block text-[12px] font-medium text-ink">{template.title}</span><span className="mt-0.5 block text-[10.5px] text-ink-3">{template.copy}</span>
                </button>
              ))}
            </div>
            <div className="my-4 h-px bg-line" />
            <Field label="Name"><input className={inputClass} value={spec.name} onChange={(event) => onChange({ ...spec, name: event.target.value })} /></Field>
            <Field label="Slug"><input className={inputClass} value={spec.slug} onChange={(event) => onChange({ ...spec, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></Field>
            <Field label="Organization"><input className={inputClass} value={spec.organization} onChange={(event) => onChange({ ...spec, organization: event.target.value })} /></Field>
            <Field label="Purpose"><textarea className={textareaClass} value={spec.description} onChange={(event) => onChange({ ...spec, description: event.target.value })} /></Field>
            <div className="my-4 h-px bg-line" />
            <Field label="Provider"><select className={inputClass} value={spec.model.provider} onChange={(event) => onChange({ ...spec, model: { ...spec.model, provider: event.target.value as HarnessSpec["model"]["provider"] } })}><option value="runbook">Deterministic runbook</option><option value="openai-compatible">OpenAI compatible</option><option value="anthropic">Anthropic</option><option value="azure-openai">Azure OpenAI</option><option value="ollama">Ollama</option></select></Field>
            <Field label="Model ID"><input className={inputClass} value={spec.model.id} onChange={(event) => onChange({ ...spec, model: { ...spec.model, id: event.target.value } })} /></Field>
          </>
        )}

        {tab === "runtime" && (
          <>
            <div className="text-[11px] font-semibold text-ink">Execution</div>
            <Toggle title="Durable sessions" description="Runs remain independent from the browser connection." value={spec.runtime.durableSessions} onChange={(value) => updateRuntime({ ...spec.runtime, durableSessions: value })} />
            <Toggle title="Dynamic subagents" description="Fan work into isolated execution contexts." value={spec.runtime.subagents.enabled} onChange={(value) => updateRuntime({ ...spec.runtime, subagents: { ...spec.runtime.subagents, enabled: value } })} />
            <Field label="Parallel workers"><input type="number" min={1} max={16} className={inputClass} value={spec.runtime.subagents.maxParallel} onChange={(event) => updateRuntime({ ...spec.runtime, subagents: { ...spec.runtime.subagents, maxParallel: Number(event.target.value) } })} /></Field>
            <Field label="Iteration limit"><input type="number" min={1} max={200} className={inputClass} value={spec.runtime.maxIterations} onChange={(event) => updateRuntime({ ...spec.runtime, maxIterations: Number(event.target.value) })} /></Field>
            <div className="my-4 h-px bg-line" />
            <div className="text-[11px] font-semibold text-ink">Context</div>
            <Toggle title="Progressive disclosure" description="Load full tool schemas only when needed." value={spec.runtime.context.progressiveDisclosure} onChange={(value) => updateRuntime({ ...spec.runtime, context: { ...spec.runtime.context, progressiveDisclosure: value } })} />
            <Toggle title="Large-result offload" description="Store heavy results as artifacts, not prompt history." value={spec.runtime.context.largeResultOffload} onChange={(value) => updateRuntime({ ...spec.runtime, context: { ...spec.runtime.context, largeResultOffload: value } })} />
            <Toggle title="Automatic compaction" description="Compact old events after the token threshold." value={spec.runtime.context.compaction.enabled} onChange={(value) => updateRuntime({ ...spec.runtime, context: { ...spec.runtime.context, compaction: { ...spec.runtime.context.compaction, enabled: value } } })} />
            <Field label="Compaction threshold"><input type="number" step={1000} min={1000} className={inputClass} value={spec.runtime.context.compaction.thresholdTokens} onChange={(event) => updateRuntime({ ...spec.runtime, context: { ...spec.runtime.context, compaction: { ...spec.runtime.context.compaction, thresholdTokens: Number(event.target.value) } } })} /></Field>
            <div className="my-4 h-px bg-line" />
            <div className="text-[11px] font-semibold text-ink">Runtime approvals</div>
            {(["read", "write", "delete"] as ToolRisk[]).map((risk) => <Toggle key={risk} title={`Require approval for ${risk}`} description={risk === "read" ? "Usually unnecessary for allowlisted reads." : "Enforced outside the model."} value={spec.runtime.approvals.requiredFor.includes(risk)} onChange={() => updateApproval(risk)} />)}
            <Field label="Sandbox"><select className={inputClass} value={spec.runtime.sandbox.provider} onChange={(event) => updateRuntime({ ...spec.runtime, sandbox: { ...spec.runtime.sandbox, provider: event.target.value as HarnessSpec["runtime"]["sandbox"]["provider"] } })}><option value="local">Local process</option><option value="container">Container</option><option value="daytona">Daytona</option></select></Field>
            <Field label="Network"><select className={inputClass} value={spec.runtime.sandbox.network} onChange={(event) => updateRuntime({ ...spec.runtime, sandbox: { ...spec.runtime.sandbox, network: event.target.value as HarnessSpec["runtime"]["sandbox"]["network"] } })}><option value="none">No network</option><option value="allowlist">Allowlist only</option><option value="unrestricted">Unrestricted</option></select></Field>
            <Field label="Event store"><select className={inputClass} value={spec.runtime.storage} onChange={(event) => updateRuntime({ ...spec.runtime, storage: event.target.value as HarnessSpec["runtime"]["storage"] })}><option value="jsonl">JSONL starter</option><option value="sqlite">SQLite</option><option value="postgres">Postgres</option></select></Field>
            <Field label="Retention days"><input type="number" min={1} max={3650} className={inputClass} value={spec.runtime.eventRetentionDays} onChange={(event) => updateRuntime({ ...spec.runtime, eventRetentionDays: Number(event.target.value) })} /></Field>
          </>
        )}

        {tab === "capabilities" && (
          <>
            <div className="flex items-center justify-between"><span className="text-[11px] font-semibold text-ink">Tools</span><button type="button" onClick={() => onChange({ ...spec, tools: [...spec.tools, { name: `custom.tool-${spec.tools.length + 1}`, description: "Describe this organizational capability and its side effects.", risk: "read", enabled: true, deferred: true }] })} className="h-7 rounded-[7px] px-2 text-[10.5px] font-medium text-ink-2 hover:bg-hover">+ Add tool</button></div>
            <div className="mt-2 grid gap-2">
              {spec.tools.map((tool, index) => (
                <div key={`${index}-${tool.name}`} className="rounded-card bg-inset p-2.5 shadow-hairline">
                  <div className="flex items-center gap-2"><button type="button" role="switch" aria-checked={tool.enabled} aria-label={`Enable ${tool.name}`} onClick={() => onChange({ ...spec, tools: spec.tools.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: !item.enabled } : item) })} className={`size-4 rounded-[5px] ${tool.enabled ? "bg-accent" : "bg-hover-2 shadow-hairline"}`}>{tool.enabled && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="m6 12 4 4 8-8"/></svg>}</button><input aria-label="Tool name" className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-ink outline-none" value={tool.name} onChange={(event) => onChange({ ...spec, tools: spec.tools.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /><button type="button" aria-label={`Remove ${tool.name}`} disabled={spec.tools.length === 1} onClick={() => onChange({ ...spec, tools: spec.tools.filter((_, itemIndex) => itemIndex !== index) })} className="flex size-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-red-tint hover:text-red disabled:opacity-30">×</button></div>
                  <textarea aria-label={`Description for ${tool.name}`} className="mt-2 min-h-14 w-full resize-y bg-transparent text-[10.5px] leading-relaxed text-ink-3 outline-none" value={tool.description} onChange={(event) => onChange({ ...spec, tools: spec.tools.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) })} />
                  <div className="mt-1 flex gap-1.5"><select aria-label={`Risk for ${tool.name}`} className="h-6 rounded-chip bg-surface px-1.5 font-mono text-[9.5px] text-ink-2 shadow-hairline" value={tool.risk} onChange={(event) => onChange({ ...spec, tools: spec.tools.map((item, itemIndex) => itemIndex === index ? { ...item, risk: event.target.value as ToolRisk } : item) })}><option value="read">read</option><option value="write">write</option><option value="delete">delete</option></select><button type="button" onClick={() => onChange({ ...spec, tools: spec.tools.map((item, itemIndex) => itemIndex === index ? { ...item, deferred: !item.deferred } : item) })} className="h-6 rounded-chip bg-surface px-2 font-mono text-[9.5px] text-ink-2 shadow-hairline">{tool.deferred ? "deferred" : "preloaded"}</button></div>
                </div>
              ))}
            </div>
            <div className="my-4 h-px bg-line" />
            <div className="flex items-center justify-between"><span className="text-[11px] font-semibold text-ink">Skills</span><button type="button" onClick={() => onChange({ ...spec, skills: [...spec.skills, { name: `organization-skill-${spec.skills.length + 1}`, description: "Describe the procedure this skill contributes to the harness.", source: "inline", enabled: true }] })} className="h-7 rounded-[7px] px-2 text-[10.5px] font-medium text-ink-2 hover:bg-hover">+ Add skill</button></div>
            <div className="mt-2 grid gap-2">
              {spec.skills.map((skill, index) => (
                <div key={`${index}-${skill.name}`} className="rounded-card bg-inset p-2.5 shadow-hairline"><div className="flex items-center gap-2"><button type="button" role="switch" aria-checked={skill.enabled} aria-label={`Enable ${skill.name}`} onClick={() => onChange({ ...spec, skills: spec.skills.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: !item.enabled } : item) })} className={`size-4 rounded-[5px] ${skill.enabled ? "bg-accent" : "bg-hover-2 shadow-hairline"}`}>{skill.enabled && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="m6 12 4 4 8-8"/></svg>}</button><input aria-label="Skill name" className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-ink outline-none" value={skill.name} onChange={(event) => onChange({ ...spec, skills: spec.skills.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /><button type="button" aria-label={`Remove ${skill.name}`} onClick={() => onChange({ ...spec, skills: spec.skills.filter((_, itemIndex) => itemIndex !== index) })} className="flex size-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-red-tint hover:text-red">×</button></div><select aria-label={`Source for ${skill.name}`} className="mt-2 h-6 rounded-chip bg-surface px-1.5 font-mono text-[9.5px] text-ink-2 shadow-hairline" value={skill.source} onChange={(event) => onChange({ ...spec, skills: spec.skills.map((item, itemIndex) => itemIndex === index ? { ...item, source: event.target.value as HarnessSpec["skills"][number]["source"] } : item) })}><option value="inline">inline</option><option value="git">git</option><option value="registry">registry</option></select></div>
              ))}
            </div>
          </>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-1.5 border-t border-line p-3">
        <span className={`mr-auto flex items-center gap-1.5 text-[10px] ${valid ? "text-green" : "text-red"}`}><span className={`size-1.5 rounded-full ${valid ? "bg-green" : "bg-red"}`} />{valid ? "Valid spec" : "Needs attention"}</span>
        <button type="button" onClick={onCopy} className="h-8 rounded-control px-2.5 text-[11px] font-medium text-ink-2 hover:bg-hover">Copy</button>
        <button type="button" onClick={onExport} className="h-8 rounded-control bg-ink px-3 text-[11px] font-medium text-surface shadow-btn hover:opacity-85">Export</button>
      </footer>
    </div>
  );
}
