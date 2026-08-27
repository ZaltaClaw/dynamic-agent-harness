import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const shell = readFileSync(resolve(root, "components/site/harness-chat.tsx"), "utf8");
const prompt = readFileSync(resolve(root, "components/primitives/PromptBar.tsx"), "utf8");
const approval = readFileSync(resolve(root, "components/primitives/ApprovalCard.tsx"), "utf8");

describe("live harness accessibility contract", () => {
  it("announces run status changes atomically", () => {
    expect(shell).toContain('role="status"');
    expect(shell).toContain('aria-live="polite"');
    expect(shell).toContain('aria-atomic="true"');
  });

  it("does not submit a prompt while an IME composition is active", () => {
    expect(prompt).toContain('event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing');
  });

  it("moves keyboard focus to a newly mounted runtime approval", () => {
    expect(approval).toContain('role="region"');
    expect(approval).toContain("aria-labelledby");
    expect(approval).toContain("approvalHeadingRef.current?.focus({ preventScroll: true })");
    expect(approval).toContain('scrollIntoView({ block: "center" })');
    expect(approval).toContain("tabIndex={-1}");
    expect(shell).toContain('resolveApproval("deny")');
    expect(shell).toContain('resolveApproval("allow")');
  });

  it("does not let the disabled mobile composer cover approval actions", () => {
    expect(shell).toContain('running ? "hidden lg:block" : ""');
  });

  it("uses at least 44px hit targets for mobile header actions", () => {
    expect(shell).toMatch(/aria-label="Start new run"[\s\S]{0,260}size-11[\s\S]{0,120}lg:size-8/);
    expect(shell).toMatch(/aria-label="Configure harness"[\s\S]{0,260}size-11[\s\S]{0,120}lg:size-7/);
  });

  it("keeps status toasts from intercepting nearby controls", () => {
    expect(shell).toMatch(/toast &&[\s\S]{0,220}pointer-events-none/);
  });

  it("does not expose upstream demo-only controls in the live shell", () => {
    for (const demoLabel of ["Shuffle suggestions", "Connect your apps", "Fork this"]) {
      expect(shell).not.toContain(demoLabel);
    }
  });
});
