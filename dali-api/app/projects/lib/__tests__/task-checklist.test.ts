import { describe, it, expect } from "vitest";
import {
  parseChecklistInput,
  normalizeChecklist,
  CHECKLIST_MAX_ITEMS,
  CHECKLIST_MAX_TEXT,
} from "~/projects/lib/task-checklist";

describe("parseChecklistInput", () => {
  it("rejects non-arrays", () => {
    expect(parseChecklistInput(null)).toBeNull();
    expect(parseChecklistInput("nope")).toBeNull();
    expect(parseChecklistInput({ text: "x" })).toBeNull();
  });

  it("rejects malformed items", () => {
    expect(parseChecklistInput([null])).toBeNull();
    expect(parseChecklistInput(["plain string"])).toBeNull();
    expect(parseChecklistInput([{ done: true }])).toBeNull();
    expect(parseChecklistInput([{ text: 5 }])).toBeNull();
    expect(parseChecklistInput([{ text: "ok", done: "yes" }])).toBeNull();
  });

  it("rejects over-cap payloads", () => {
    const tooMany = Array.from({ length: CHECKLIST_MAX_ITEMS + 1 }, () => ({ text: "x" }));
    expect(parseChecklistInput(tooMany)).toBeNull();
    expect(
      parseChecklistInput([{ text: "x".repeat(CHECKLIST_MAX_TEXT + 1) }]),
    ).toBeNull();
  });

  it("trims text, coerces done, and drops empties", () => {
    expect(
      parseChecklistInput([
        { text: "  a  ", done: true },
        { text: "   " },
        { text: "b" },
      ]),
    ).toEqual([
      { text: "a", done: true },
      { text: "b", done: false },
    ]);
  });

  it("accepts an empty array", () => {
    expect(parseChecklistInput([])).toEqual([]);
  });
});

describe("normalizeChecklist", () => {
  it("trims, drops empties, and caps count", () => {
    const items = [
      { text: "  keep  ", done: true },
      { text: "   ", done: false },
      ...Array.from({ length: CHECKLIST_MAX_ITEMS + 5 }, (_, i) => ({
        text: `item ${i}`,
        done: false,
      })),
    ];
    const out = normalizeChecklist(items);
    expect(out[0]).toEqual({ text: "keep", done: true });
    expect(out).toHaveLength(CHECKLIST_MAX_ITEMS);
    expect(out.some((it) => it.text === "")).toBe(false);
  });

  it("caps text length", () => {
    const out = normalizeChecklist([
      { text: "x".repeat(CHECKLIST_MAX_TEXT + 50), done: false },
    ]);
    expect(out[0].text).toHaveLength(CHECKLIST_MAX_TEXT);
  });
});
