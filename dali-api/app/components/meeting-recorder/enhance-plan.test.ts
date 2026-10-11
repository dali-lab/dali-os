import { describe, expect, it } from "vitest";
import { actionItemMatchesBlock, applyEnhancePlan, type EnhancePlan, type SnapshotBlock } from "./enhance-plan";

const block = (id: string, type: string, text: string): SnapshotBlock => ({ id, type, text });

describe("applyEnhancePlan", () => {
  it("produces no op for a keep block", () => {
    const snapshot = [block("b1", "paragraph", "Hello")];
    const current = [block("b1", "paragraph", "Hello")];
    const plan: EnhancePlan = { blocks: [{ id: "b1", op: "keep" }], actionItems: [] };

    const result = applyEnhancePlan(snapshot, current, plan);

    expect(result.ops).toEqual([]);
    expect(result.skipped).toBe(0);
  });

  it("expands a block whose live text still matches the snapshot", () => {
    const snapshot = [block("b1", "paragraph", "Scope change")];
    const current = [block("b1", "paragraph", "Scope change")];
    const plan: EnhancePlan = {
      blocks: [{ id: "b1", op: "expand", text: "Scope change: drop the dashboard.", cites: [812.4] }],
      actionItems: [],
    };

    const result = applyEnhancePlan(snapshot, current, plan);

    expect(result.ops).toEqual([
      { kind: "update", id: "b1", text: "Scope change: drop the dashboard.", cites: [812.4] },
    ]);
    expect(result.skipped).toBe(0);
  });

  it("skips an expand when the live text diverged from the snapshot (hand edit while generating)", () => {
    const snapshot = [block("b1", "paragraph", "Scope change")];
    const current = [block("b1", "paragraph", "Scope change — edited by someone")];
    const plan: EnhancePlan = {
      blocks: [{ id: "b1", op: "expand", text: "Scope change: drop the dashboard.", cites: [812.4] }],
      actionItems: [],
    };

    const result = applyEnhancePlan(snapshot, current, plan);

    expect(result.ops).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  it("skips an expand whose block was deleted entirely before apply", () => {
    const snapshot = [block("b1", "paragraph", "Scope change")];
    const current: SnapshotBlock[] = [];
    const plan: EnhancePlan = {
      blocks: [{ id: "b1", op: "expand", text: "Scope change: drop the dashboard.", cites: [812.4] }],
      actionItems: [],
    };

    const result = applyEnhancePlan(snapshot, current, plan);

    expect(result.ops).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  it("inserts after a block that's still in the live doc", () => {
    const snapshot = [block("b1", "heading", "Decisions"), block("b2", "bullet", "Ship v1")];
    const current = [block("b1", "heading", "Decisions"), block("b2", "bullet", "Ship v1")];
    const plan: EnhancePlan = {
      blocks: [
        { id: "b1", op: "keep" },
        { id: "b2", op: "keep" },
        { op: "insert", after: "b2", type: "bullet", text: "Partner agreed", cites: [901.2] },
      ],
      actionItems: [],
    };

    const result = applyEnhancePlan(snapshot, current, plan);

    expect(result.ops).toEqual([
      {
        kind: "insertAfter",
        afterId: "b2",
        blocks: [{ type: "bullet", text: "Partner agreed", cites: [901.2], added: true }],
      },
    ]);
  });

  it("falls back to the end of the section when the named anchor is gone but a sibling survives", () => {
    const snapshot = [
      block("h1", "heading", "Notes"),
      block("b1", "bullet", "Point one"),
      block("b2", "bullet", "Point two"),
      block("h2", "heading", "Decisions"),
    ];
    // b2 (the named anchor) was deleted by hand before Enhance applied.
    const current = [block("h1", "heading", "Notes"), block("b1", "bullet", "Point one"), block("h2", "heading", "Decisions")];
    const plan: EnhancePlan = {
      blocks: [
        { id: "h1", op: "keep" },
        { id: "b1", op: "keep" },
        { id: "b2", op: "keep" },
        { id: "h2", op: "keep" },
        { op: "insert", after: "b2", type: "bullet", text: "Added detail", cites: [10] },
      ],
      actionItems: [],
    };

    const result = applyEnhancePlan(snapshot, current, plan);

    expect(result.ops).toEqual([
      { kind: "insertAfter", afterId: "b1", blocks: [{ type: "bullet", text: "Added detail", cites: [10], added: true }] },
    ]);
  });

  it("falls back to the end of the doc when the whole section (anchor and siblings) is gone", () => {
    const snapshot = [
      block("h1", "heading", "Notes"),
      block("b1", "bullet", "Point one"),
      block("h2", "heading", "Decisions"),
      block("b2", "bullet", "Kept decision"),
    ];
    // The entire "Notes" section — heading and bullet — was deleted.
    const current = [block("h2", "heading", "Decisions"), block("b2", "bullet", "Kept decision")];
    const plan: EnhancePlan = {
      blocks: [
        { id: "h1", op: "keep" },
        { id: "b1", op: "keep" },
        { id: "h2", op: "keep" },
        { id: "b2", op: "keep" },
        { op: "insert", after: "b1", type: "bullet", text: "Added detail", cites: [10] },
      ],
      actionItems: [],
    };

    const result = applyEnhancePlan(snapshot, current, plan);

    expect(result.ops).toEqual([
      { kind: "insertAfter", afterId: "b2", blocks: [{ type: "bullet", text: "Added detail", cites: [10], added: true }] },
    ]);
  });

  it("inserts at the very start (afterId null) when the live doc is empty", () => {
    const snapshot = [block("b1", "paragraph", "Hello")];
    const current: SnapshotBlock[] = [];
    const plan: EnhancePlan = {
      blocks: [{ op: "insert", after: "b1", type: "paragraph", text: "New content", cites: [] }],
      actionItems: [],
    };

    const result = applyEnhancePlan(snapshot, current, plan);

    expect(result.ops).toEqual([
      { kind: "insertAfter", afterId: null, blocks: [{ type: "paragraph", text: "New content", cites: [], added: true }] },
    ]);
  });

  it("merges consecutive inserts anchored at the same surviving block into one op, in plan order", () => {
    const snapshot = [block("b1", "heading", "Decisions")];
    const current = [block("b1", "heading", "Decisions")];
    const plan: EnhancePlan = {
      blocks: [
        { id: "b1", op: "keep" },
        { op: "insert", after: "b1", type: "bullet", text: "First", cites: [1] },
        { op: "insert", after: "b1", type: "bullet", text: "Second", cites: [2] },
      ],
      actionItems: [],
    };

    const result = applyEnhancePlan(snapshot, current, plan);

    expect(result.ops).toEqual([
      {
        kind: "insertAfter",
        afterId: "b1",
        blocks: [
          { type: "bullet", text: "First", cites: [1], added: true },
          { type: "bullet", text: "Second", cites: [2], added: true },
        ],
      },
    ]);
  });

  it("does not merge inserts anchored at different surviving blocks", () => {
    const snapshot = [block("b1", "heading", "Decisions"), block("b2", "heading", "Action items")];
    const current = [block("b1", "heading", "Decisions"), block("b2", "heading", "Action items")];
    const plan: EnhancePlan = {
      blocks: [
        { id: "b1", op: "keep" },
        { id: "b2", op: "keep" },
        { op: "insert", after: "b1", type: "bullet", text: "Decision bullet", cites: [1] },
        { op: "insert", after: "b2", type: "bullet", text: "Action bullet", cites: [2] },
      ],
      actionItems: [],
    };

    const result = applyEnhancePlan(snapshot, current, plan);

    expect(result.ops).toEqual([
      { kind: "insertAfter", afterId: "b1", blocks: [{ type: "bullet", text: "Decision bullet", cites: [1], added: true }] },
      { kind: "insertAfter", afterId: "b2", blocks: [{ type: "bullet", text: "Action bullet", cites: [2], added: true }] },
    ]);
  });

  it("hides an empty template heading on an untouched template when nothing was inserted under it", () => {
    const snapshot = [block("h1", "heading", "Agenda"), block("h2", "heading", "Notes")];
    const current = [block("h1", "heading", "Agenda"), block("h2", "heading", "Notes")];
    const plan: EnhancePlan = {
      blocks: [
        { id: "h1", op: "keep" },
        { id: "h2", op: "keep" },
      ],
      actionItems: [],
    };

    const result = applyEnhancePlan(snapshot, current, plan, { untouchedTemplate: true });

    expect(result.ops).toEqual([
      { kind: "remove", id: "h1" },
      { kind: "remove", id: "h2" },
    ]);
    expect(result.hiddenHeadings).toBe(2);
  });

  it("keeps a template heading that the model filled in with an insert", () => {
    const snapshot = [block("h1", "heading", "Decisions")];
    const current = [block("h1", "heading", "Decisions")];
    const plan: EnhancePlan = {
      blocks: [
        { id: "h1", op: "keep" },
        { op: "insert", after: "h1", type: "bullet", text: "Ship v1", cites: [5] },
      ],
      actionItems: [],
    };

    const result = applyEnhancePlan(snapshot, current, plan, { untouchedTemplate: true });

    expect(result.ops.some((op) => op.kind === "remove")).toBe(false);
    expect(result.hiddenHeadings).toBe(0);
  });

  it("never hides empty headings when the note was not an untouched template", () => {
    const snapshot = [block("h1", "heading", "Agenda")];
    const current = [block("h1", "heading", "Agenda")];
    const plan: EnhancePlan = { blocks: [{ id: "h1", op: "keep" }], actionItems: [] };

    const result = applyEnhancePlan(snapshot, current, plan, { untouchedTemplate: false });

    expect(result.ops).toEqual([]);
    expect(result.hiddenHeadings).toBe(0);
  });

  it("defaults cites to an empty array when the model omits them", () => {
    const snapshot = [block("b1", "paragraph", "Hello")];
    const current = [block("b1", "paragraph", "Hello")];
    const plan: EnhancePlan = { blocks: [{ id: "b1", op: "expand", text: "Hello there" }], actionItems: [] };

    const result = applyEnhancePlan(snapshot, current, plan);

    expect(result.ops).toEqual([{ kind: "update", id: "b1", text: "Hello there", cites: [] }]);
  });

  it("never duplicates a transcript toggle heading kept unchanged (keep ops carry no text to rewrite)", () => {
    const snapshot = [block("t1", "heading", "Transcript")];
    const current = [block("t1", "heading", "Transcript")];
    const plan: EnhancePlan = { blocks: [{ id: "t1", op: "keep" }], actionItems: [] };

    const result = applyEnhancePlan(snapshot, current, plan);

    expect(result.ops).toEqual([]);
  });
});

describe("actionItemMatchesBlock", () => {
  it("matches identical text", () => {
    expect(actionItemMatchesBlock("Send the revised scope", "Send the revised scope")).toBe(true);
  });

  it("is case- and punctuation-insensitive", () => {
    expect(actionItemMatchesBlock("Send the revised scope.", "SEND THE REVISED SCOPE")).toBe(true);
  });

  it("collapses whitespace differences", () => {
    expect(actionItemMatchesBlock("Send   the  revised scope", "Send the revised scope")).toBe(true);
  });

  it("matches when the block text has an owner prefix the item text doesn't", () => {
    expect(actionItemMatchesBlock("Send the revised scope", "Ada: Send the revised scope")).toBe(true);
  });

  it("matches when the item text has detail the block text was trimmed of", () => {
    expect(actionItemMatchesBlock("Send the revised scope by Friday", "Send the revised scope")).toBe(true);
  });

  it("does not match a short substring (under 12 chars), even though it is literally contained", () => {
    expect(actionItemMatchesBlock("Ship it", "Let's ship it now")).toBe(false);
  });

  it("does not match unrelated text", () => {
    expect(actionItemMatchesBlock("Send the revised scope", "Book the conference room")).toBe(false);
  });

  it("does not match empty text", () => {
    expect(actionItemMatchesBlock("", "")).toBe(false);
    expect(actionItemMatchesBlock("   ", "Send the revised scope")).toBe(false);
  });
});
