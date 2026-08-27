import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const css = readFileSync(resolve(root, "app/globals.css"), "utf8");
const layout = readFileSync(resolve(root, "app/layout.tsx"), "utf8");
const page = readFileSync(resolve(root, "app/page.tsx"), "utf8");
const loadingState = readFileSync(resolve(root, "components/primitives/LoadingState.tsx"), "utf8");
const recordsTable = readFileSync(resolve(root, "components/primitives/RecordsTable.tsx"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const upstreamPrimitiveNames = [
  "ApprovalCard.tsx",
  "ChatComposer.tsx",
  "CodeBlock.tsx",
  "ContextCards.tsx",
  "DiffTable.tsx",
  "FilterTable.tsx",
  "FineTuneCard.tsx",
  "Flowchart.tsx",
  "GlideMenu.tsx",
  "InsightCards.tsx",
  "LoadingState.tsx",
  "PromptBar.tsx",
  "RecommendationCard.tsx",
  "RecordsTable.tsx",
  "SearchList.tsx",
  "SelectionActions.tsx",
  "SidebarNav.tsx",
  "StreamingText.tsx",
  "TaskRows.tsx",
  "ThinkingState.tsx",
  "ToolChips.tsx",
];

describe("Beautiful UI harness fidelity", () => {
  it("vendors the complete upstream primitive layer", () => {
    for (const filename of upstreamPrimitiveNames) {
      expect(existsSync(resolve(root, "components/primitives", filename)), filename).toBe(true);
    }
  });

  it("uses the upstream token, radius, hairline, and shadow system", () => {
    expect(css).toContain('@import "shadow-plugin/unprefixed"');
    expect(css).toContain(".dark {");
    expect(css).toContain("--page: oklch(0.985 0.001 286.376)");
    expect(css).toContain("--surface: oklch(1 0 0)");
    expect(css).toContain("--shadow-hairline: 0 0 0 1px var(--line)");
    expect(css).toContain("--shadow-card:");
    expect(css).toContain("--radius-chip: 6px");
    expect(css).toContain("--radius-control: 8px");
    expect(css).toContain("--radius-card: 10px");
    expect(css).toContain("--radius-window: 14px");
  });

  it("boots the upstream font and dark-theme contract", () => {
    expect(layout).toContain("Inter");
    expect(layout).toContain("JetBrains_Mono");
    expect(layout).toContain("--font-inter");
    expect(layout).toContain("--font-mono-face");
    expect(layout).toContain('classList.toggle("dark"');
    expect(layout).toContain('t!=="light"');
  });

  it("renders the real backend-wired harness shell instead of the old dashboard", () => {
    expect(page).toContain("HarnessChat");
    expect(page).not.toContain("HarnessStudio");
    const shellPath = resolve(root, "components/site/harness-chat.tsx");
    expect(existsSync(shellPath)).toBe(true);
    const shell = existsSync(shellPath) ? readFileSync(shellPath, "utf8") : "";
    expect(shell).not.toContain("SCENARIOS");
    expect(shell).toContain('fetch("/api/runs"');
    expect(shell).toContain("new EventSource");
    expect(shell).toContain("/approvals");
    expect(shell).toContain("<PromptBar");
    expect(shell).toContain("<ThinkingState");
    expect(shell).toContain("<ToolChips");
    expect(shell).toContain("<ApprovalCard");
    expect(shell).toContain("<StreamingText");
  });

  it("does not assume an unowned demo video asset", () => {
    expect(loadingState).not.toContain("/subway-surfers.mp4");
  });

  it("drops commercial icons and optional demo instrumentation", () => {
    expect(recordsTable).not.toContain("data-cuelume-silent");
    const dependencyNames = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ]);
    for (const forbidden of [
      "@central-icons-react/round-outlined-radius-2-stroke-2",
      "cuelume",
      "dialkit",
      "posthog-js",
    ]) {
      expect(dependencyNames.has(forbidden), forbidden).toBe(false);
    }
  });
});
