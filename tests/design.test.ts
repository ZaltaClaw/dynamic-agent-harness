import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const studio = readFileSync(resolve(root, "components/studio/harness-studio.tsx"), "utf8");
const css = readFileSync(resolve(root, "app/globals.css"), "utf8");
const layout = readFileSync(resolve(root, "app/layout.tsx"), "utf8");
const appIcon = readFileSync(resolve(root, "app/icon.svg"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
  license?: string;
  repository?: { type?: string; url?: string };
  bugs?: { url?: string };
  homepage?: string;
  engines?: { node?: string };
};
const readme = readFileSync(resolve(root, "README.md"), "utf8");
const security = readFileSync(resolve(root, "SECURITY.md"), "utf8");
const thirdPartyNotices = readFileSync(resolve(root, "THIRD_PARTY_NOTICES.md"), "utf8");

function blockAfter(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Missing CSS marker: ${marker}`);
  const openIndex = source.indexOf("{", markerIndex + marker.length);
  if (openIndex < 0) throw new Error(`Missing CSS block for: ${marker}`);

  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openIndex + 1, index);
  }
  throw new Error(`Unclosed CSS block for: ${marker}`);
}

describe("studio visual shell contract", () => {
  it("uses a restrained windowed workspace without a decorative brand logo", () => {
    expect(studio).not.toContain("brand-mark");
    expect(css).not.toContain(".brand-mark");
    expect(studio).toContain('className="workspace-shell"');
    expect(studio).toContain('className="canvas-window"');
  });

  it("starts in the reference-inspired light theme", () => {
    expect(layout).toContain("||'light'");
    expect(layout).toContain("dataset.theme='light'");
  });

  it("uses the repository name in browser metadata", () => {
    expect(layout).toContain('title: "Dynamic Agent Harness Studio');
    expect(layout).not.toContain('title: "Open Harness Studio');
  });

  it("keeps the browser icon monochrome and free of the removed sparkle brand", () => {
    expect(appIcon).not.toContain("linearGradient");
    expect(appIcon).not.toContain("#7c8cff");
    expect(appIcon).not.toContain("#5a62d9");
    expect(appIcon).not.toContain("12.7");
  });
});

// These source-level release guards catch known regressions. They complement,
// rather than replace, keyboard and responsive checks in a real browser.
describe("static release source guards", () => {
  it("publishes complete repository and runtime metadata", () => {
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "https://github.com/ZaltaClaw/dynamic-agent-harness.git",
    });
    expect(packageJson.bugs?.url).toBe("https://github.com/ZaltaClaw/dynamic-agent-harness/issues");
    expect(packageJson.homepage).toBe("https://github.com/ZaltaClaw/dynamic-agent-harness#readme");
    expect(packageJson.engines?.node).toBe(">=22");
  });

  it("pins development and production servers to the IPv4 loopback interface", () => {
    expect(packageJson.scripts.dev).toBe("next dev --hostname 127.0.0.1 -p 3110");
    expect(packageJson.scripts.start).toBe("next start --hostname 127.0.0.1 -p 3110");
    expect(readme).toContain("http://127.0.0.1:3110");
    expect(security).toContain("127.0.0.1");
    expect(readme).not.toContain("http://localhost:3110");
  });

  it("keeps the builder and labeled section navigation usable at 780px and below", () => {
    const mobile = blockAfter(css, "@media (max-width: 780px)");
    const formSection = blockAfter(mobile, ".form-section");
    const nav = blockAfter(mobile, ".rail-nav");
    const navItem = blockAfter(mobile, ".nav-item");
    const navLabel = blockAfter(mobile, ".nav-item span:last-child");

    expect(formSection).toMatch(/display:\s*block/);
    expect(nav).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(navItem).toMatch(/min-height:\s*44px/);
    expect(navItem).toMatch(/justify-content:\s*flex-start/);
    expect(navLabel).toMatch(/display:\s*inline/);
    expect(mobile).not.toMatch(/\.field-label[^{}]*\{[^}]*display:\s*none/);
  });

  it("gives every form control a focus-visible outline without local suppression", () => {
    const formControlFocus = blockAfter(
      css,
      "input:focus-visible, textarea:focus-visible, select:focus-visible",
    );
    const focusRules = [...css.matchAll(/([^{}]+:(?:focus|focus-visible)[^{}]*)\{([^{}]*)\}/g)];
    const suppressedControlOutlines = focusRules
      .filter(([, selector, declarations]) =>
        /(?:input|textarea|select|field-|capability-|prompt-input|compact-select)/.test(selector)
        && /outline:\s*(?:none|0)\b/.test(declarations),
      )
      .map(([, selector]) => selector.trim());

    expect(formControlFocus).toMatch(/outline:\s*2px solid var\(--accent\)/);
    expect(formControlFocus).toMatch(/outline-offset:\s*2px/);
    expect(suppressedControlOutlines).toEqual([]);
    for (const className of [
      "field-input",
      "field-select",
      "capability-name",
      "capability-description",
      "compact-select",
      "prompt-input",
    ]) {
      expect(studio).toContain(`className="${className}"`);
    }
  });

  it("associates complete upstream license terms with adapted sources and emitted fonts", () => {
    for (const notice of [
      "Copyright (c) 2026 Shane Levine",
      "Copyright (c) 2024-2026 TrueFoundry",
      "Copyright (c) 2026 DeepSeek",
    ]) {
      expect(thirdPartyNotices).toContain(notice);
    }
    expect(thirdPartyNotices).toContain(
      "applies separately to Beautiful UI, TrueForge, and DeepSeek Harness",
    );
    expect(thirdPartyNotices).toContain(
      "in the Software without restriction, including without limitation the rights",
    );
    expect(thirdPartyNotices).toContain(
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    );
    expect(thirdPartyNotices).toContain("`next/font/google`");
    expect(thirdPartyNotices).toContain("emits self-hosted font files");
    expect(thirdPartyNotices).toContain("Copyright 2020 The Inter Project Authors");
    expect(thirdPartyNotices).toContain("Copyright 2020 The JetBrains Mono Project Authors");
    expect(thirdPartyNotices).toContain(
      "SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007",
    );
  });
});
