// Unit tests for pure helpers in AiSlashMenuItems.
// Only pure functions that require no DOM/BlockNote runtime are tested here.

import { describe, it, expect } from "vitest";
import { capMarkdown, CONTEXT_CHAR_CAP } from "../AiSlashMenuItems";

describe("capMarkdown", () => {
  it("returns the string unchanged when under the cap", () => {
    const short = "Hello world";
    expect(capMarkdown(short)).toBe(short);
  });

  it("truncates from the START (keeps the TAIL) when over the cap", () => {
    const tail = "TAIL".repeat(10);
    const over = "X".repeat(CONTEXT_CHAR_CAP) + tail;
    const result = capMarkdown(over);
    expect(result.length).toBe(CONTEXT_CHAR_CAP);
    expect(result.endsWith(tail)).toBe(true);
  });

  it("accepts a custom cap", () => {
    const s = "abcdef";
    expect(capMarkdown(s, 3)).toBe("def");
  });

  it("returns empty string for empty input", () => {
    expect(capMarkdown("")).toBe("");
  });

  it("returns exactly cap chars when input equals cap", () => {
    const s = "a".repeat(CONTEXT_CHAR_CAP);
    expect(capMarkdown(s)).toBe(s);
  });
});
