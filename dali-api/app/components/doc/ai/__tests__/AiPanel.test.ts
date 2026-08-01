// Unit tests for pure helpers in AiPanel.ts.
// effectiveApplyMode is the load-bearing decision table for mode/scope → apply mode.

import { describe, it, expect } from "vitest";
import { effectiveApplyMode } from "../AiPanel";

describe("effectiveApplyMode", () => {
  // ── improve ───────────────────────────────────────────────────────────────
  it("improve / slash / block → replace", () => {
    expect(effectiveApplyMode("improve", "slash", "block")).toBe("replace");
  });
  it("improve / slash / document → replace", () => {
    expect(effectiveApplyMode("improve", "slash", "document")).toBe("replace");
  });
  it("improve / toolbar / selection → replace", () => {
    expect(effectiveApplyMode("improve", "toolbar", "selection")).toBe("replace");
  });
  it("improve / toolbar / document → replace", () => {
    expect(effectiveApplyMode("improve", "toolbar", "document")).toBe("replace");
  });

  // ── fix ───────────────────────────────────────────────────────────────────
  it("fix / slash / block → replace", () => {
    expect(effectiveApplyMode("fix", "slash", "block")).toBe("replace");
  });
  it("fix / slash / document → replace", () => {
    expect(effectiveApplyMode("fix", "slash", "document")).toBe("replace");
  });
  it("fix / toolbar / selection → replace", () => {
    expect(effectiveApplyMode("fix", "toolbar", "selection")).toBe("replace");
  });
  it("fix / toolbar / document → replace", () => {
    expect(effectiveApplyMode("fix", "toolbar", "document")).toBe("replace");
  });

  // ── summarize ─────────────────────────────────────────────────────────────
  it("summarize / slash / block → insert", () => {
    expect(effectiveApplyMode("summarize", "slash", "block")).toBe("insert");
  });
  it("summarize / slash / document → insert", () => {
    expect(effectiveApplyMode("summarize", "slash", "document")).toBe("insert");
  });
  it("summarize / toolbar / selection → insert", () => {
    expect(effectiveApplyMode("summarize", "toolbar", "selection")).toBe("insert");
  });
  it("summarize / toolbar / document → insert", () => {
    expect(effectiveApplyMode("summarize", "toolbar", "document")).toBe("insert");
  });

  // ── prompt ────────────────────────────────────────────────────────────────
  // slash Ask AI inserts (never replaces — no scope content removed)
  it("prompt / slash / block → insert", () => {
    expect(effectiveApplyMode("prompt", "slash", "block")).toBe("insert");
  });
  it("prompt / slash / document → insert", () => {
    expect(effectiveApplyMode("prompt", "slash", "document")).toBe("insert");
  });
  // toolbar Ask AI replaces selection (Notion parity)
  it("prompt / toolbar / selection → replace", () => {
    expect(effectiveApplyMode("prompt", "toolbar", "selection")).toBe("replace");
  });
  it("prompt / toolbar / document → replace", () => {
    expect(effectiveApplyMode("prompt", "toolbar", "document")).toBe("replace");
  });

  // ── continue ──────────────────────────────────────────────────────────────
  // Always insert — scope is implicit (from cursor), never destructive
  it("continue / slash / block → insert", () => {
    expect(effectiveApplyMode("continue", "slash", "block")).toBe("insert");
  });
  it("continue / slash / document → insert", () => {
    expect(effectiveApplyMode("continue", "slash", "document")).toBe("insert");
  });
});
