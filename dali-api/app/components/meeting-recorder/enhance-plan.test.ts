import { describe, expect, it } from "vitest";
import {
  actionItemMatchesBlock,
  applyEnhancePlan,
  buildEnhanceChangeRows,
  classifyEnhanceMark,
  ENHANCE_MARK_ADDED,
  ENHANCE_MARK_PRIOR,
  firstLineOf,
  headingAbove,
  isUndoRedoTransaction,
  localEditKeepIds,
  markOfProps,
  snapshotTree,
  summarizeEnhanceMarks,
  type EnhanceBlockChange,
  type EnhanceMarkEntry,
  type EnhancePlan,
  type SnapshotBlock,
} from "./enhance-plan";

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

describe("markOfProps", () => {
  it("recognizes both reserved values", () => {
    expect(markOfProps({ backgroundColor: ENHANCE_MARK_ADDED })).toBe(ENHANCE_MARK_ADDED);
    expect(markOfProps({ backgroundColor: ENHANCE_MARK_PRIOR })).toBe(ENHANCE_MARK_PRIOR);
  });

  it("returns null for any other value, including a normal Colors swatch", () => {
    expect(markOfProps({ backgroundColor: "yellow" })).toBeNull();
    expect(markOfProps({ backgroundColor: "default" })).toBeNull();
    expect(markOfProps({})).toBeNull();
    expect(markOfProps(undefined)).toBeNull();
  });
});

describe("localEditKeepIds (specs/meeting-recording-rail.md Step 2: local edit counts as Keep)", () => {
  const marks: EnhanceMarkEntry[] = [{ id: "b1", mark: ENHANCE_MARK_ADDED, type: "paragraph", text: "x" }];

  function change(overrides: Partial<EnhanceBlockChange> = {}): EnhanceBlockChange {
    return {
      type: "update",
      source: { type: "local" },
      block: { id: "b1", props: { backgroundColor: ENHANCE_MARK_ADDED } },
      prevBlock: { id: "b1", props: { backgroundColor: ENHANCE_MARK_ADDED } },
      ...overrides,
    };
  }

  it("keeps a block a local edit touched while it was already marked", () => {
    expect(localEditKeepIds([change()], marks)).toEqual(["b1"]);
  });

  it("does not keep the Enhance-apply transaction itself (prevBlock had no mark yet)", () => {
    const c = change({ prevBlock: { id: "b1", props: {} } });
    expect(localEditKeepIds([c], marks)).toEqual([]);
  });

  it("does not keep a remote (Yjs) change", () => {
    const c = change({ source: { type: "yjs-remote" } });
    expect(localEditKeepIds([c], marks)).toEqual([]);
  });

  it("does not keep an undo/redo change", () => {
    expect(localEditKeepIds([change({ source: { type: "undo" } })], marks)).toEqual([]);
    expect(localEditKeepIds([change({ source: { type: "redo" } })], marks)).toEqual([]);
    expect(localEditKeepIds([change({ source: { type: "undo-redo" } })], marks)).toEqual([]);
  });

  it("treats paste and drop as local", () => {
    expect(localEditKeepIds([change({ source: { type: "paste" } })], marks)).toEqual(["b1"]);
    expect(localEditKeepIds([change({ source: { type: "drop" } })], marks)).toEqual(["b1"]);
  });

  it("ignores insert/delete/move changes", () => {
    expect(localEditKeepIds([change({ type: "insert", prevBlock: undefined })], marks)).toEqual([]);
    expect(localEditKeepIds([change({ type: "delete", prevBlock: undefined })], marks)).toEqual([]);
    expect(localEditKeepIds([change({ type: "move" })], marks)).toEqual([]);
  });

  it("does not re-trigger on the change produced by clearing the mark itself (no recursion)", () => {
    // The block is no longer in the current marks list — this is exactly the
    // follow-up change keepEnhanceBlock's own update produces.
    const c = change({ block: { id: "b1", props: {} } });
    expect(localEditKeepIds([c], [])).toEqual([]);
  });

  it("ignores a change to a block that was never marked", () => {
    const c: EnhanceBlockChange = {
      type: "update",
      source: { type: "local" },
      block: { id: "other", props: {} },
      prevBlock: { id: "other", props: {} },
    };
    expect(localEditKeepIds([c], marks)).toEqual([]);
  });
});

describe("firstLineOf", () => {
  it("returns the whole string when there is no newline", () => {
    expect(firstLineOf("Discussed the budget")).toBe("Discussed the budget");
  });

  it("returns only the first line, trimmed", () => {
    expect(firstLineOf("Discussed the budget\nMore detail here")).toBe("Discussed the budget");
  });
});

describe("classifyEnhanceMark", () => {
  it("is Removed for the prior mark, regardless of priorBlocks", () => {
    expect(classifyEnhanceMark({ id: "b1", mark: ENHANCE_MARK_PRIOR }, { b1: {} })).toBe("Removed");
    expect(classifyEnhanceMark({ id: "b1", mark: ENHANCE_MARK_PRIOR }, undefined)).toBe("Removed");
  });

  it("is Changed for the added mark when the id is in priorBlocks", () => {
    expect(classifyEnhanceMark({ id: "b1", mark: ENHANCE_MARK_ADDED }, { b1: {} })).toBe("Changed");
  });

  it("is Added for the added mark when the id is not in priorBlocks", () => {
    expect(classifyEnhanceMark({ id: "b1", mark: ENHANCE_MARK_ADDED }, { b2: {} })).toBe("Added");
    expect(classifyEnhanceMark({ id: "b1", mark: ENHANCE_MARK_ADDED }, undefined)).toBe("Added");
  });
});

describe("summarizeEnhanceMarks", () => {
  it("counts changed/added/removed across a mixed mark list", () => {
    const marks: EnhanceMarkEntry[] = [
      { id: "b1", mark: ENHANCE_MARK_ADDED, type: "paragraph", text: "changed" },
      { id: "b2", mark: ENHANCE_MARK_ADDED, type: "paragraph", text: "added" },
      { id: "b3", mark: ENHANCE_MARK_ADDED, type: "paragraph", text: "added too" },
      { id: "b4", mark: ENHANCE_MARK_PRIOR, type: "heading", text: "" },
    ];
    expect(summarizeEnhanceMarks(marks, { b1: {} })).toEqual({ changed: 1, added: 2, removed: 1 });
  });

  it("is all zero for an empty mark list", () => {
    expect(summarizeEnhanceMarks([], undefined)).toEqual({ changed: 0, added: 0, removed: 0 });
  });
});

describe("headingAbove", () => {
  const blocks: SnapshotBlock[] = [
    block("h1", "heading", "Agenda"),
    block("p1", "paragraph", "Intro line"),
    block("h2", "heading", "Notes"),
    block("p2", "paragraph", "Discussion"),
    block("p3", "paragraph", "More discussion"),
  ];

  it("finds the nearest preceding heading, skipping non-heading blocks", () => {
    expect(headingAbove(blocks, "p3")).toBe("Notes");
  });

  it("returns the immediately preceding heading when the block follows it directly", () => {
    expect(headingAbove(blocks, "p1")).toBe("Agenda");
  });

  it("returns null for the first block (nothing above it)", () => {
    expect(headingAbove(blocks, "h1")).toBeNull();
  });

  it("returns null for an id not in the list", () => {
    expect(headingAbove(blocks, "missing")).toBeNull();
  });

  it("returns null when no heading precedes the block", () => {
    const noHeadings: SnapshotBlock[] = [block("p1", "paragraph", "a"), block("p2", "paragraph", "b")];
    expect(headingAbove(noHeadings, "p2")).toBeNull();
  });
});

describe("buildEnhanceChangeRows", () => {
  const blocks: SnapshotBlock[] = [
    block("h1", "heading", "Notes"),
    block("b1", "paragraph", "New text for b1"),
    block("b2", "paragraph", "A brand new block"),
    block("b3", "heading", "Untouched template heading"),
  ];
  const marks: EnhanceMarkEntry[] = [
    { id: "b1", mark: ENHANCE_MARK_ADDED, type: "paragraph", text: "New text for b1\nextra" },
    { id: "b2", mark: ENHANCE_MARK_ADDED, type: "paragraph", text: "A brand new block" },
    { id: "b3", mark: ENHANCE_MARK_PRIOR, type: "heading", text: "Untouched template heading" },
  ];
  const priorBlocks = {
    b1: { id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "Old text for b1", styles: {} }], children: [] },
  };

  it("emits one row per mark, in document order, with the kind classified from priorBlocks", () => {
    const rows = buildEnhanceChangeRows(marks, blocks, priorBlocks);
    expect(rows.map((r) => r.id)).toEqual(["b1", "b2", "b3"]);
    expect(rows.map((r) => r.kind)).toEqual(["Changed", "Added", "Removed"]);
  });

  it("takes only the first line of the block's current text", () => {
    const rows = buildEnhanceChangeRows(marks, blocks, priorBlocks);
    expect(rows[0]!.text).toBe("New text for b1");
  });

  it("looks up the nearest heading above each block", () => {
    const rows = buildEnhanceChangeRows(marks, blocks, priorBlocks);
    expect(rows.every((r) => r.heading === "Notes")).toBe(true);
  });

  it("shows 'Was: …' (first line of the prior block's own text) only for a Changed row", () => {
    const rows = buildEnhanceChangeRows(marks, blocks, priorBlocks);
    expect(rows[0]!.priorText).toBe("Old text for b1");
    expect(rows[1]!.priorText).toBeNull();
    expect(rows[2]!.priorText).toBeNull();
  });

  it("returns an empty list for no marks", () => {
    expect(buildEnhanceChangeRows([], blocks, priorBlocks)).toEqual([]);
  });
});

describe("isUndoRedoTransaction", () => {
  const change = (type: string): EnhanceBlockChange => ({
    type: "update",
    source: { type },
    block: { id: "b1" },
  });

  it("is true when every change is undo-redo", () => {
    expect(isUndoRedoTransaction([change("undo-redo"), change("undo-redo")])).toBe(true);
  });

  it("is false for an empty change list", () => {
    expect(isUndoRedoTransaction([])).toBe(false);
  });

  it.each(["local", "paste", "drop"])("is false when a %s change is in the transaction", (type) => {
    expect(isUndoRedoTransaction([change("undo-redo"), change(type)])).toBe(false);
  });

  it("is false for remote changes alone", () => {
    expect(isUndoRedoTransaction([change("yjs-remote")])).toBe(false);
  });
});

describe("snapshotTree", () => {
  type Node = { id: string; type: string; content: { type: string; text: string; styles: object }[]; children: Node[] };
  const node = (id: string, type: string, text: string, children: Node[] = []): Node => ({
    id,
    type,
    content: [{ type: "text", text, styles: {} }],
    children,
  });

  it("flattens nested blocks in document order, tagging each child with its parent", () => {
    const doc = [node("p", "bulletListItem", "Budget", [node("c", "bulletListItem", "40 hours", [node("g", "paragraph", "spring")])]), node("q", "paragraph", "Next")];
    expect(snapshotTree(doc)).toEqual([
      { id: "p", type: "bulletListItem", text: "Budget" },
      { id: "c", type: "bulletListItem", text: "40 hours", parentId: "p" },
      { id: "g", type: "paragraph", text: "spring", parentId: "c" },
      { id: "q", type: "paragraph", text: "Next" },
    ]);
  });

  it("skips blank leaf blocks like the trailing empty paragraph", () => {
    expect(snapshotTree([node("a", "paragraph", "Notes"), node("b", "paragraph", "  "), node("c", "paragraph", "")])).toEqual([
      { id: "a", type: "paragraph", text: "Notes" },
    ]);
  });

  it("keeps a blank block that has non-blank children", () => {
    expect(snapshotTree([node("a", "bulletListItem", "", [node("b", "bulletListItem", "Child")])])).toEqual([
      { id: "a", type: "bulletListItem", text: "" },
      { id: "b", type: "bulletListItem", text: "Child", parentId: "a" },
    ]);
  });

  it("returns nothing for an empty note", () => {
    expect(snapshotTree([node("a", "paragraph", "")])).toEqual([]);
  });
});

describe("applyEnhancePlan with nested blocks", () => {
  const child = (id: string, text: string, parentId: string): SnapshotBlock => ({ id, type: "bulletListItem", text, parentId });

  it("expands a nested block like any other", () => {
    const blocks = [block("p", "bulletListItem", "Budget"), child("c", "40h", "p")];
    const plan: EnhancePlan = { blocks: [{ id: "p", op: "keep" }, { id: "c", op: "expand", text: "40h for spring", cites: [5] }], actionItems: [] };
    expect(applyEnhancePlan(blocks, blocks, plan).ops).toEqual([{ kind: "update", id: "c", text: "40h for spring", cites: [5] }]);
  });

  it("turns an insert under a live block into appendChildren", () => {
    const blocks = [block("p", "bulletListItem", "Budget")];
    const plan: EnhancePlan = {
      blocks: [{ op: "insert", after: null, under: "p", type: "bulletListItem", text: "Partner approved 40h", cites: [5] }],
      actionItems: [],
    };
    expect(applyEnhancePlan(blocks, blocks, plan).ops).toEqual([
      { kind: "appendChildren", parentId: "p", blocks: [{ type: "bulletListItem", text: "Partner approved 40h", cites: [5], added: true }] },
    ]);
  });

  it("falls back to the end of the parent's section when the parent is gone", () => {
    const snapshot = [block("h", "heading", "Budget"), block("p", "bulletListItem", "Hours"), block("q", "paragraph", "Rates")];
    const current = [block("h", "heading", "Budget"), block("q", "paragraph", "Rates")];
    const plan: EnhancePlan = {
      blocks: [{ op: "insert", after: null, under: "p", type: "bulletListItem", text: "40h", cites: [] }],
      actionItems: [],
    };
    expect(applyEnhancePlan(snapshot, current, plan).ops).toEqual([
      { kind: "insertAfter", afterId: "q", blocks: [{ type: "bulletListItem", text: "40h", cites: [], added: true }] },
    ]);
  });

  it("never falls back to a nested block as an insert anchor", () => {
    const snapshot = [block("h", "heading", "Budget"), block("p", "bulletListItem", "Hours"), child("c", "40h", "p"), block("x", "paragraph", "gone")];
    const current = [block("h", "heading", "Budget"), block("p", "bulletListItem", "Hours"), child("c", "40h", "p")];
    const plan: EnhancePlan = { blocks: [{ op: "insert", after: "x", type: "paragraph", text: "More", cites: [] }], actionItems: [] };
    expect(applyEnhancePlan(snapshot, current, plan).ops[0]).toMatchObject({ kind: "insertAfter", afterId: "p" });
  });

  it("does not treat a nested heading as a section boundary", () => {
    const snapshot = [block("h", "heading", "Budget"), { ...block("n", "heading", "Sub"), parentId: "h" }, block("p", "paragraph", "Hours"), block("x", "paragraph", "gone")];
    const current = snapshot.filter((b) => b.id !== "x");
    const plan: EnhancePlan = { blocks: [{ op: "insert", after: "x", type: "paragraph", text: "More", cites: [] }], actionItems: [] };
    expect(applyEnhancePlan(snapshot, current, plan).ops[0]).toMatchObject({ kind: "insertAfter", afterId: "p" });
  });

  it("collects non-consecutive inserts at the same anchor into one op, in plan order", () => {
    const blocks = [block("a", "paragraph", "A"), block("b", "paragraph", "B")];
    const plan: EnhancePlan = {
      blocks: [
        { op: "insert", after: "a", type: "paragraph", text: "first", cites: [] },
        { id: "b", op: "expand", text: "B more", cites: [] },
        { op: "insert", after: "a", type: "paragraph", text: "second", cites: [] },
      ],
      actionItems: [],
    };
    const { ops } = applyEnhancePlan(blocks, blocks, plan);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ kind: "insertAfter", afterId: "a", blocks: [{ text: "first" }, { text: "second" }] });
  });
});

describe("applyEnhancePlan action items section", () => {
  const item = (text: string, cites: number[] = [7]) => ({ text, cites });

  it("appends an Action items heading and one checklist item per action item at the bottom of the note", () => {
    const blocks = [block("a", "paragraph", "Notes"), { ...block("c", "bulletListItem", "nested"), parentId: "a" }];
    const plan: EnhancePlan = { blocks: [], actionItems: [item("Ada sends the scope"), item("Ben books the room", [9])] };
    expect(applyEnhancePlan(blocks, blocks, plan).ops).toEqual([
      {
        kind: "appendAtEnd",
        blocks: [
          { type: "heading", text: "Action items", cites: [], added: true },
          { type: "checkListItem", text: "Ada sends the scope", cites: [7], added: true },
          { type: "checkListItem", text: "Ben books the room", cites: [9], added: true },
        ],
      },
    ]);
  });

  it("emits the section after every model insert, so it stays at the bottom", () => {
    const blocks = [block("a", "paragraph", "Notes")];
    const plan: EnhancePlan = {
      blocks: [{ op: "insert", after: "a", type: "heading", text: "Decisions", cites: [1] }],
      actionItems: [item("Ada sends the scope")],
    };
    expect(applyEnhancePlan(blocks, blocks, plan).ops.map((o) => o.kind)).toEqual(["insertAfter", "appendAtEnd"]);
  });

  it("appends the section to an empty note too", () => {
    const plan: EnhancePlan = { blocks: [], actionItems: [item("Ada sends the scope")] };
    expect(applyEnhancePlan([], [], plan).ops[0]).toMatchObject({ kind: "appendAtEnd" });
  });

  it("fills the author's own Action items heading instead of adding a second one", () => {
    const blocks = [
      block("h1", "heading", "Action items:"),
      block("x", "checkListItem", "Existing"),
      block("h2", "heading", "Notes"),
      block("n", "paragraph", "Stuff"),
    ];
    const plan: EnhancePlan = { blocks: [], actionItems: [item("Ada sends the scope")] };
    expect(applyEnhancePlan(blocks, blocks, plan).ops).toEqual([
      { kind: "insertAfter", afterId: "x", blocks: [{ type: "checkListItem", text: "Ada sends the scope", cites: [7], added: true }] },
    ]);
  });

  it("skips an action item already in the note as a checklist item", () => {
    const blocks = [block("a", "checkListItem", "Ada sends the revised scope")];
    const plan: EnhancePlan = { blocks: [], actionItems: [item("ada sends the revised scope.")] };
    expect(applyEnhancePlan(blocks, blocks, plan).ops).toEqual([]);
  });

  it("adds nothing when there are no action items", () => {
    const blocks = [block("a", "paragraph", "Notes")];
    expect(applyEnhancePlan(blocks, blocks, { blocks: [], actionItems: [] }).ops).toEqual([]);
  });

  it("drops the model's own checklist and Action items heading inserts", () => {
    const blocks = [block("a", "paragraph", "Notes")];
    const plan: EnhancePlan = {
      blocks: [
        { op: "insert", after: "a", type: "heading", text: "Action Items", cites: [1] },
        { op: "insert", after: "a", type: "checkListItem", text: "Ada sends the scope", cites: [1] },
      ],
      actionItems: [item("Ada sends the scope")],
    };
    const { ops } = applyEnhancePlan(blocks, blocks, plan);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: "appendAtEnd" });
    expect((ops[0] as { blocks: { text: string }[] }).blocks.map((b) => b.text)).toEqual(["Action items", "Ada sends the scope"]);
  });

  it("keeps an untouched template's Action items heading once it is filled", () => {
    const blocks = [block("h1", "heading", "Agenda"), block("h2", "heading", "Action items")];
    const plan: EnhancePlan = { blocks: [{ id: "h1", op: "keep" }, { id: "h2", op: "keep" }], actionItems: [item("Ada sends the scope")] };
    const result = applyEnhancePlan(blocks, blocks, plan, { untouchedTemplate: true });
    expect(result.ops).toContainEqual({ kind: "remove", id: "h1" });
    expect(result.ops).not.toContainEqual({ kind: "remove", id: "h2" });
    expect(result.hiddenHeadings).toBe(1);
  });
});
