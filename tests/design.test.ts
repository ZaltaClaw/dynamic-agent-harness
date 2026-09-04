import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const shell = readFileSync(resolve(root, "components/site/harness-chat.tsx"), "utf8");
const inspector = readFileSync(resolve(root, "components/site/run-inspector.tsx"), "utf8");
const config = readFileSync(resolve(root, "components/site/harness-config.tsx"), "utf8");
const promptBar = readFileSync(resolve(root, "components/primitives/PromptBar.tsx"), "utf8");
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

type Oklch = readonly [lightness: number, chroma: number, hue: number];

function oklchToken(block: string, name: string): Oklch | null {
  const match = block.match(new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function requiredOklchToken(block: string, name: string): Oklch {
  const value = oklchToken(block, name);
  if (!value) throw new Error(`Missing opaque OKLCH token: --${name}`);
  return value;
}

function relativeLuminance([lightness, chroma, hue]: Oklch): number {
  const radians = hue * Math.PI / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (channel: number) => Math.min(1, Math.max(0, channel));
  const red = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: Oklch, second: Oklch): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("studio visual shell contract", () => {
  it("uses a restrained windowed workspace without a decorative brand logo", () => {
    expect(shell).not.toContain("brand-mark");
    expect(css).not.toContain(".brand-mark");
    expect(shell).toContain("rounded-window");
    expect(shell).toContain("<HarnessSidebar");
  });

  it("starts in the upstream reference dark theme unless light is saved", () => {
    expect(layout).toContain('classList.toggle("dark",t!=="light")');
    expect(layout).toContain('classList.add("dark")');
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

  it("keeps the chat shell and side panels usable below the desktop breakpoint", () => {
    expect(shell).toContain("lg:hidden");
    expect(shell).toContain("fixed inset-2 z-50");
    expect(shell).toContain("lg:static");
    expect(shell).toContain("lg:w-[360px]");
    expect(shell).toContain("min-w-0 flex-1");
    expect(promptBar).toContain("w-full");
    expect(promptBar).toContain("resize-none");
  });

  it("gives form controls a focus-visible outline and local focus treatment", () => {
    const formControlFocus = blockAfter(css, "input:focus-visible,");

    expect(formControlFocus).toMatch(/outline:\s*2px solid var\(--accent\)/);
    expect(formControlFocus).toMatch(/outline-offset:\s*2px/);
    expect(config).toContain("focus:border-accent");
    expect(config).toContain("focus:shadow-[0_0_0_3px_var(--accent-tint)]");
    expect(promptBar).toContain("focus-within:border-accent");
  });

  it("keeps normal success text above WCAG AA contrast in light mode", () => {
    const lightTokens = blockAfter(css, ":root");
    const darkTokens = blockAfter(css, "\n.dark");
    const successInk = oklchToken(lightTokens, "green-ink") ?? requiredOklchToken(lightTokens, "green");
    const greenTint = requiredOklchToken(lightTokens, "green-tint");
    const surface = requiredOklchToken(lightTokens, "surface");

    expect(contrastRatio(successInk, greenTint)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(successInk, surface)).toBeGreaterThanOrEqual(4.5);
    expect(lightTokens).toMatch(/--green-ink:\s*oklch\(/);
    expect(darkTokens).toContain("--green-ink: var(--green);");
    expect(css).toContain("--color-green-ink: var(--green-ink);");
    expect(shell).toContain('outcome.tone === "success" ? "text-green-ink" : "text-ink-2"');
    expect(shell).toMatch(/view\.artifactPath && <button[^\n]+text-green-ink/);
    expect(inspector.match(/text-green-ink/g)).toHaveLength(2);
    expect(inspector).not.toContain("text-green/80");
  });

  it("associates complete upstream license terms with adapted sources and emitted fonts", () => {
    for (const notice of [
      "Copyright (c) 2026 Shane Levine",
      "Copyright (c) 2024-2026 TrueFoundry",
      "Copyright (c) 2026 DeepSeek",
      "Copyright (c) 2026 Noman Ijaz - iamnoman.com",
      "Copyright (c) 2021 Daniel Martin",
      "Copyright (c) 2025-2026 Benji Taylor",
      "Copyright (c) 2026 Florian Kiem",
    ]) {
      expect(thirdPartyNotices).toContain(notice);
    }
    expect(thirdPartyNotices).toContain(
      "applies separately to Beautiful UI, TrueForge, DeepSeek Harness, glimm, Iconoir, Liveline, and shadow-plugin",
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
