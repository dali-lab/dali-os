// Unit tests for the doc package's pure helpers (node environment — no DOM,
// no BlockNote imports, no ~/lib/db.server).

import { describe, expect, it, vi } from "vitest";
import { ENHANCE_MARK_ADDED, ENHANCE_MARK_PRIOR } from "~/components/meeting-recorder/enhance-plan";
import type { EditorOp, EnhanceActionItem, EnhanceOpBlock } from "~/components/meeting-recorder/enhance-plan";
import {
  appendTaskMentionContent,
  clearEnhanceMark,
  enhancePasteHandler,
  findEnhanceMarks,
  findTranscriptToggle,
  hasEnhanceMarks,
  keepAllEnhance,
  keepEnhanceBlock,
  renderEnhanceOps,
  revertAllEnhance,
  revertEnhanceBlock,
  stripEnhanceMarksFromHtml,
  toPartialBlock,
  transcriptToggleBlock,
} from "../enhance-render";
import type { DocBlock, DocEditorInstance } from "../schema/build";

describe("appendTaskMentionContent", () => {
  it("appends a space + taskMention node to existing content", () => {
    const content = appendTaskMentionContent(
      [{ type: "text", text: "Ship it", styles: {} }] as never,
      { taskId: "t1", projectId: "proj1", label: "Ship it" },
    );
    expect(content).toEqual([
      { type: "text", text: "Ship it", styles: {} },
      { type: "text", text: " ", styles: {} },
      { type: "taskMention", props: { taskId: "t1", projectId: "proj1", label: "Ship it" } },
    ]);
  });

  it("starts a fresh array when the block had no content yet", () => {
    const content = appendTaskMentionContent(undefined, {
      taskId: "t2",
      projectId: "proj2",
      label: "Draft the brief",
    });
    expect(content).toEqual([
      { type: "text", text: " ", styles: {} },
      { type: "taskMention", props: { taskId: "t2", projectId: "proj2", label: "Draft the brief" } },
    ]);
  });

  it("does not mutate the input content array", () => {
    const original = [{ type: "text", text: "x", styles: {} }] as never;
    const before = JSON.stringify(original);
    appendTaskMentionContent(original, { taskId: "t3", projectId: "p3", label: "x" });
    expect(JSON.stringify(original)).toBe(before);
  });
});

// Create tasks can run BEFORE Apply (specs/meeting-notes-model.md §4), so the
// checklist block Apply inserts never existed for onTaskCreated to link a
// task to — toPartialBlock links it itself as it inserts the block.
describe("toPartialBlock — linking a checklist insert to an already-created task", () => {
  const checklistBlock = (text: string): EnhanceOpBlock => ({ type: "checkListItem", text, cites: [], added: true });

  it("appends a taskMention when the inserted checklist text matches an action item with a taskId", () => {
    const actionItems: EnhanceActionItem[] = [{ text: "Send the revised scope", taskId: "task1" }];
    const result = toPartialBlock(checklistBlock("Send the revised scope"), "p1", "rec1", {
      actionItems,
      projectId: "proj1",
    });
    expect(JSON.stringify(result.content)).toContain("taskMention");
    expect(JSON.stringify(result.content)).toContain("task1");
  });

  it("does not append a taskMention when the matching action item has no taskId yet", () => {
    const actionItems: EnhanceActionItem[] = [{ text: "Send the revised scope" }];
    const result = toPartialBlock(checklistBlock("Send the revised scope"), "p1", "rec1", {
      actionItems,
      projectId: "proj1",
    });
    expect(JSON.stringify(result.content)).not.toContain("taskMention");
  });

  it("does not append a taskMention without a projectId, even with a taskId match", () => {
    const actionItems: EnhanceActionItem[] = [{ text: "Send the revised scope", taskId: "task1" }];
    const result = toPartialBlock(checklistBlock("Send the revised scope"), "p1", "rec1", { actionItems });
    expect(JSON.stringify(result.content)).not.toContain("taskMention");
  });

  it("does not append a taskMention when no action item's text matches the block", () => {
    const actionItems: EnhanceActionItem[] = [{ text: "Book the conference room", taskId: "task1" }];
    const result = toPartialBlock(checklistBlock("Send the revised scope"), "p1", "rec1", {
      actionItems,
      projectId: "proj1",
    });
    expect(JSON.stringify(result.content)).not.toContain("taskMention");
  });

  it("still renders an unchecked checklist block when ctx is omitted entirely", () => {
    const result = toPartialBlock(checklistBlock("Send the revised scope"), "p1", "rec1");
    expect(result.type).toBe("checkListItem");
    expect(result.props).toEqual({ checked: false });
  });
});

describe("transcriptToggleBlock / findTranscriptToggle", () => {
  it("builds a toggleable heading named Transcript with one paragraph per line", () => {
    const block = transcriptToggleBlock(["[00:00] You: hi", "[00:05] Others: hey"]);
    expect(block.type).toBe("heading");
    expect((block.props as { isToggleable?: boolean }).isToggleable).toBe(true);
    expect(block.children).toHaveLength(2);
  });

  it("finds the Transcript toggle among a document's top-level blocks", () => {
    const toggle = transcriptToggleBlock(["[00:00] You: hi"]) as unknown as DocBlock;
    const other = { id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "notes", styles: {} }], children: [] } as unknown as DocBlock;
    const found = findTranscriptToggle([other, { ...toggle, id: "t1" }]);
    expect(found?.id).toBe("t1");
  });

  it("returns null when the document has no Transcript toggle", () => {
    const other = { id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "notes", styles: {} }], children: [] } as unknown as DocBlock;
    expect(findTranscriptToggle([other])).toBeNull();
  });

  it("does not match a toggleable heading with a different title", () => {
    const decoy = {
      id: "h1",
      type: "heading",
      props: { level: 3, isToggleable: true },
      content: [{ type: "text", text: "Summary", styles: {} }],
      children: [],
    } as unknown as DocBlock;
    expect(findTranscriptToggle([decoy])).toBeNull();
  });

  it("does not match a non-toggleable heading titled Transcript", () => {
    const plainHeading = {
      id: "h1",
      type: "heading",
      props: { level: 3 },
      content: [{ type: "text", text: "Transcript", styles: {} }],
      children: [],
    } as unknown as DocBlock;
    expect(findTranscriptToggle([plainHeading])).toBeNull();
  });
});

// ─── Enhance marks (specs/meeting-recording-rail.md Step 2) ───────────────

// Real BlockNote blocks always resolve every registered prop (backgroundColor
// included) to an explicit value — "default" when unset, never absent — since
// nodeToBlock reads the ProseMirror node's full resolved attrs. The fake
// editor below mirrors that so a revert's merge-with-old-attrs semantics
// (props spread, not replaced) behaves the same as the real editor.updateBlock.
function block(id: string, type: string, text: string, props: Record<string, unknown> = {}): DocBlock {
  return {
    id,
    type,
    props: { backgroundColor: "default", ...props },
    content: [{ type: "text", text, styles: {} }],
    children: [],
  } as unknown as DocBlock;
}

/** A minimal BlockNoteEditor double — just enough surface for renderEnhanceOps
 *  and the Keep/Revert helpers to drive, with no real BlockNote/ProseMirror
 *  underneath. `transact` just runs the callback synchronously, matching
 *  editor.transact's documented behavior (changes grouped, dispatched when
 *  the callback returns) closely enough for these ops-replay tests. */
function fakeEditor(initial: DocBlock[]) {
  let blocks = initial;
  const editor = {
    get document() {
      return blocks;
    },
    getBlock: (id: string) => blocks.find((b) => b.id === id),
    updateBlock: (id: string, update: { content?: unknown; props?: Record<string, unknown> }) => {
      blocks = blocks.map((b) =>
        b.id === id
          ? ({
              ...b,
              ...(update.content !== undefined ? { content: update.content } : {}),
              ...("children" in update ? { children: (update as { children?: unknown }).children } : {}),
              props: { ...b.props, ...(update.props ?? {}) },
            } as DocBlock)
          : b,
      );
    },
    insertBlocks: (toInsert: DocBlock[], ref: string | { id: string }, placement: "before" | "after" = "before") => {
      const refId = typeof ref === "string" ? ref : ref.id;
      const idx = blocks.findIndex((b) => b.id === refId);
      const at = placement === "after" ? idx + 1 : idx;
      blocks = [...blocks.slice(0, at), ...toInsert, ...blocks.slice(at)];
    },
    removeBlocks: (ids: string[]) => {
      blocks = blocks.filter((b) => !ids.includes(b.id));
    },
    replaceBlocks: (_remove: DocBlock[], insert: DocBlock[]) => {
      blocks = insert;
    },
    transact: vi.fn(<T>(cb: () => T): T => cb()),
  };
  return editor as unknown as DocEditorInstance & typeof editor;
}

describe("renderEnhanceOps", () => {
  it("runs every op inside a single editor.transact call", () => {
    const editor = fakeEditor([block("b1", "paragraph", "Hello"), block("b2", "heading", "Agenda")]);
    const ops: EditorOp[] = [
      { kind: "update", id: "b1", text: "Hello there", cites: [] },
      { kind: "remove", id: "b2" },
    ];
    renderEnhanceOps(editor, ops, { notePath: "/documents/p1", recordingId: "rec1" });
    expect(editor.transact).toHaveBeenCalledTimes(1);
  });

  it("tints an updated block enhance-added and captures its prior JSON", () => {
    const editor = fakeEditor([block("b1", "paragraph", "Hello")]);
    const ops: EditorOp[] = [{ kind: "update", id: "b1", text: "Hello there", cites: [] }];

    const { priorBlocks } = renderEnhanceOps(editor, ops, { notePath: "/documents/p1", recordingId: "rec1" });

    const updated = editor.getBlock("b1")!;
    expect((updated.props as { backgroundColor?: unknown }).backgroundColor).toBe(ENHANCE_MARK_ADDED);
    expect(priorBlocks.b1).toMatchObject({ id: "b1", type: "paragraph" });
    expect((priorBlocks.b1 as DocBlock).content).toEqual([{ type: "text", text: "Hello", styles: {} }]);
  });

  it("deep-clones the prior block — mutating the live block afterward doesn't change it", () => {
    const editor = fakeEditor([block("b1", "paragraph", "Hello")]);
    const ops: EditorOp[] = [{ kind: "update", id: "b1", text: "Hello there", cites: [] }];

    const { priorBlocks } = renderEnhanceOps(editor, ops, { notePath: "/documents/p1", recordingId: "rec1" });
    editor.updateBlock("b1", { content: [{ type: "text", text: "Mutated later", styles: {} }] });

    expect((priorBlocks.b1 as DocBlock).content).toEqual([{ type: "text", text: "Hello", styles: {} }]);
  });

  it("tints every inserted block enhance-added", () => {
    const editor = fakeEditor([block("b1", "heading", "Decisions")]);
    const ops: EditorOp[] = [
      { kind: "insertAfter", afterId: "b1", blocks: [{ type: "bulletListItem", text: "Ship v1", cites: [], added: true }] },
    ];

    renderEnhanceOps(editor, ops, { notePath: "/documents/p1", recordingId: "rec1" });

    const inserted = editor.document.find((b) => b.type === "bulletListItem")!;
    expect((inserted.props as { backgroundColor?: unknown }).backgroundColor).toBe(ENHANCE_MARK_ADDED);
  });

  it("tints a removed block enhance-prior instead of deleting it", () => {
    const editor = fakeEditor([block("b1", "heading", "Agenda")]);
    const ops: EditorOp[] = [{ kind: "remove", id: "b1" }];

    renderEnhanceOps(editor, ops, { notePath: "/documents/p1", recordingId: "rec1" });

    expect(editor.document).toHaveLength(1);
    expect((editor.getBlock("b1")!.props as { backgroundColor?: unknown }).backgroundColor).toBe(ENHANCE_MARK_PRIOR);
  });

  it("only records priorBlocks for update ops, not inserts or removes", () => {
    const editor = fakeEditor([block("b1", "heading", "Agenda"), block("b2", "paragraph", "Keep me")]);
    const ops: EditorOp[] = [
      { kind: "remove", id: "b1" },
      { kind: "insertAfter", afterId: "b2", blocks: [{ type: "paragraph", text: "New", cites: [], added: true }] },
    ];

    const { priorBlocks } = renderEnhanceOps(editor, ops, { notePath: "/documents/p1", recordingId: "rec1" });

    expect(priorBlocks).toEqual({});
  });
});

describe("findEnhanceMarks / hasEnhanceMarks", () => {
  it("finds every top-level block carrying a reserved mark, in order", () => {
    const blocks = [
      block("b1", "paragraph", "Added text", { backgroundColor: ENHANCE_MARK_ADDED }),
      block("b2", "paragraph", "Untouched"),
      block("b3", "heading", "Gone heading", { backgroundColor: ENHANCE_MARK_PRIOR }),
    ];
    expect(findEnhanceMarks(blocks)).toEqual([
      { id: "b1", mark: ENHANCE_MARK_ADDED, type: "paragraph", text: "Added text" },
      { id: "b3", mark: ENHANCE_MARK_PRIOR, type: "heading", text: "Gone heading" },
    ]);
  });

  it("ignores a normal color swatch and the default value", () => {
    const blocks = [
      block("b1", "paragraph", "Blue", { backgroundColor: "blue" }),
      block("b2", "paragraph", "Default", { backgroundColor: "default" }),
    ];
    expect(findEnhanceMarks(blocks)).toEqual([]);
    expect(hasEnhanceMarks(blocks)).toBe(false);
  });

  it("hasEnhanceMarks is true when any block carries either reserved value", () => {
    expect(hasEnhanceMarks([block("b1", "paragraph", "x", { backgroundColor: ENHANCE_MARK_PRIOR })])).toBe(true);
  });
});

describe("clearEnhanceMark", () => {
  it("resets backgroundColor to default", () => {
    const editor = fakeEditor([block("b1", "paragraph", "x", { backgroundColor: ENHANCE_MARK_ADDED })]);
    clearEnhanceMark(editor, "b1");
    expect((editor.getBlock("b1")!.props as { backgroundColor?: unknown }).backgroundColor).toBe("default");
  });

  it("is a no-op when the block no longer exists", () => {
    const editor = fakeEditor([]);
    expect(() => clearEnhanceMark(editor, "gone")).not.toThrow();
  });
});

describe("keepEnhanceBlock", () => {
  it("clears the tint on an enhance-added block, keeping its content", () => {
    const editor = fakeEditor([block("b1", "paragraph", "New text", { backgroundColor: ENHANCE_MARK_ADDED })]);
    keepEnhanceBlock(editor, "b1");
    const kept = editor.getBlock("b1")!;
    expect((kept.props as { backgroundColor?: unknown }).backgroundColor).toBe("default");
    expect(kept.content).toEqual([{ type: "text", text: "New text", styles: {} }]);
  });

  it("deletes an enhance-prior block outright", () => {
    const editor = fakeEditor([block("b1", "heading", "Agenda", { backgroundColor: ENHANCE_MARK_PRIOR })]);
    keepEnhanceBlock(editor, "b1");
    expect(editor.document).toHaveLength(0);
  });

  it("is a no-op on a block with no mark", () => {
    const editor = fakeEditor([block("b1", "paragraph", "Plain")]);
    keepEnhanceBlock(editor, "b1");
    expect(editor.document).toHaveLength(1);
  });

  it("is a no-op when the id no longer exists", () => {
    const editor = fakeEditor([]);
    expect(() => keepEnhanceBlock(editor, "gone")).not.toThrow();
  });
});

describe("revertEnhanceBlock", () => {
  it("restores a changed block from priorBlocks", () => {
    const prior: DocBlock = block("b1", "paragraph", "Original text");
    const editor = fakeEditor([block("b1", "paragraph", "Enhanced text", { backgroundColor: ENHANCE_MARK_ADDED })]);

    revertEnhanceBlock(editor, "b1", { b1: prior });

    const reverted = editor.getBlock("b1")!;
    expect(reverted.content).toEqual([{ type: "text", text: "Original text", styles: {} }]);
    expect((reverted.props as { backgroundColor?: unknown }).backgroundColor).toBe("default");
  });

  it("deletes an added block with no prior entry (a genuine insert)", () => {
    const editor = fakeEditor([block("b1", "paragraph", "New block", { backgroundColor: ENHANCE_MARK_ADDED })]);
    revertEnhanceBlock(editor, "b1", {});
    expect(editor.document).toHaveLength(0);
  });

  it("clears the tint on an enhance-prior block, leaving it as it was", () => {
    const editor = fakeEditor([block("b1", "heading", "Agenda", { backgroundColor: ENHANCE_MARK_PRIOR })]);
    revertEnhanceBlock(editor, "b1", {});
    const reverted = editor.getBlock("b1")!;
    expect((reverted.props as { backgroundColor?: unknown }).backgroundColor).toBe("default");
    expect(editor.document).toHaveLength(1);
  });

  it("is a no-op on a block with no mark, even with a priorBlocks entry", () => {
    const prior: DocBlock = block("b1", "paragraph", "Original");
    const editor = fakeEditor([block("b1", "paragraph", "Plain")]);
    revertEnhanceBlock(editor, "b1", { b1: prior });
    expect(editor.getBlock("b1")!.content).toEqual([{ type: "text", text: "Plain", styles: {} }]);
  });

  it("is a no-op when the id no longer exists", () => {
    const editor = fakeEditor([]);
    expect(() => revertEnhanceBlock(editor, "gone", {})).not.toThrow();
  });
});

describe("keepAllEnhance / revertAllEnhance", () => {
  it("keeps every currently-marked block in one transaction and returns the count", () => {
    const editor = fakeEditor([
      block("b1", "paragraph", "Added", { backgroundColor: ENHANCE_MARK_ADDED }),
      block("b2", "heading", "Gone", { backgroundColor: ENHANCE_MARK_PRIOR }),
      block("b3", "paragraph", "Untouched"),
    ]);

    const count = keepAllEnhance(editor);

    expect(count).toBe(2);
    expect(editor.transact).toHaveBeenCalledTimes(1);
    expect(editor.document.map((b) => b.id)).toEqual(["b1", "b3"]);
    expect((editor.getBlock("b1")!.props as { backgroundColor?: unknown }).backgroundColor).toBe("default");
  });

  it("reverts every currently-marked block in one transaction and returns the count", () => {
    const prior: DocBlock = block("b1", "paragraph", "Original");
    const editor = fakeEditor([
      block("b1", "paragraph", "Enhanced", { backgroundColor: ENHANCE_MARK_ADDED }),
      block("b2", "heading", "Gone", { backgroundColor: ENHANCE_MARK_PRIOR }),
    ]);

    const count = revertAllEnhance(editor, { b1: prior });

    expect(count).toBe(2);
    expect(editor.getBlock("b1")!.content).toEqual([{ type: "text", text: "Original", styles: {} }]);
    expect(editor.getBlock("b2")).toBeDefined();
  });

  it("skips an id that's already gone by the time its turn comes", () => {
    const editor = fakeEditor([
      block("b1", "paragraph", "Added", { backgroundColor: ENHANCE_MARK_ADDED }),
      block("b2", "paragraph", "Also added", { backgroundColor: ENHANCE_MARK_ADDED }),
    ]);
    // Simulate a concurrent removal of b2 between the scan and its turn.
    const realGetBlock = editor.getBlock.bind(editor);
    editor.getBlock = ((id: string) => (id === "b2" ? undefined : realGetBlock(id))) as typeof editor.getBlock;

    const count = keepAllEnhance(editor);

    expect(count).toBe(1);
  });

  it("returns 0 when nothing is marked", () => {
    const editor = fakeEditor([block("b1", "paragraph", "Plain")]);
    expect(keepAllEnhance(editor)).toBe(0);
    expect(revertAllEnhance(editor, {})).toBe(0);
  });
});

describe("stripEnhanceMarksFromHtml", () => {
  it("strips a double-quoted enhance-added attribute", () => {
    const html = '<div data-background-color="enhance-added">x</div>';
    expect(stripEnhanceMarksFromHtml(html)).toBe("<div>x</div>");
  });

  it("strips a single-quoted enhance-prior attribute", () => {
    const html = "<div data-background-color='enhance-prior'>x</div>";
    expect(stripEnhanceMarksFromHtml(html)).toBe("<div>x</div>");
  });

  it("leaves a normal color swatch value alone", () => {
    const html = '<div data-background-color="blue">x</div>';
    expect(stripEnhanceMarksFromHtml(html)).toBe(html);
  });

  it("does not strip a value that merely starts with a reserved word", () => {
    const html = '<div data-background-color="enhance-added-extra">x</div>';
    expect(stripEnhanceMarksFromHtml(html)).toBe(html);
  });

  it("strips every occurrence across multiple blocks", () => {
    const html =
      '<div data-background-color="enhance-added">a</div><div data-background-color="enhance-prior">b</div>';
    expect(stripEnhanceMarksFromHtml(html)).toBe("<div>a</div><div>b</div>");
  });
});

function clipboardEvent(entries: Record<string, string>): ClipboardEvent {
  return {
    clipboardData: {
      types: Object.keys(entries),
      getData: (format: string) => entries[format] ?? "",
    },
  } as unknown as ClipboardEvent;
}

describe("enhancePasteHandler", () => {
  it("delegates to defaultPasteHandler when there is no clipboard data", () => {
    const defaultPasteHandler = vi.fn().mockReturnValue(true);
    const event = { clipboardData: null } as unknown as ClipboardEvent;
    const result = enhancePasteHandler({ event, editor: { pasteHTML: vi.fn() }, defaultPasteHandler });
    expect(result).toBe(true);
    expect(defaultPasteHandler).toHaveBeenCalledWith();
  });

  it("delegates when the top-priority HTML format carries no reserved mark", () => {
    const defaultPasteHandler = vi.fn().mockReturnValue(true);
    const pasteHTML = vi.fn();
    const event = clipboardEvent({ "blocknote/html": "<p>hi</p>", "text/plain": "hi" });
    const result = enhancePasteHandler({ event, editor: { pasteHTML }, defaultPasteHandler });
    expect(result).toBe(true);
    expect(pasteHTML).not.toHaveBeenCalled();
    expect(defaultPasteHandler).toHaveBeenCalled();
  });

  it("strips marks from blocknote/html and pastes it raw itself", () => {
    const defaultPasteHandler = vi.fn();
    const pasteHTML = vi.fn();
    const html = '<div data-background-color="enhance-added">hi</div>';
    const event = clipboardEvent({ "blocknote/html": html, "text/html": html });
    const result = enhancePasteHandler({ event, editor: { pasteHTML }, defaultPasteHandler });
    expect(result).toBe(true);
    expect(pasteHTML).toHaveBeenCalledWith("<div>hi</div>", true);
    expect(defaultPasteHandler).not.toHaveBeenCalled();
  });

  it("strips marks from text/html (not raw) when blocknote/html isn't present", () => {
    const defaultPasteHandler = vi.fn();
    const pasteHTML = vi.fn();
    const html = '<div data-background-color="enhance-prior">hi</div>';
    const event = clipboardEvent({ "text/html": html });
    const result = enhancePasteHandler({ event, editor: { pasteHTML }, defaultPasteHandler });
    expect(result).toBe(true);
    expect(pasteHTML).toHaveBeenCalledWith("<div>hi</div>", false);
  });

  it("ignores a mark sitting in a lower-priority format when the top format present is unmarked", () => {
    const defaultPasteHandler = vi.fn().mockReturnValue(true);
    const pasteHTML = vi.fn();
    const event = clipboardEvent({
      "blocknote/html": "<p>hi</p>",
      "text/html": '<div data-background-color="enhance-added">hi</div>',
    });
    enhancePasteHandler({ event, editor: { pasteHTML }, defaultPasteHandler });
    expect(pasteHTML).not.toHaveBeenCalled();
    expect(defaultPasteHandler).toHaveBeenCalled();
  });
});

describe("Enhance on nested blocks", () => {
  const withChildren = (b: DocBlock, children: DocBlock[]) => ({ ...b, children }) as DocBlock;

  it("findEnhanceMarks finds marks on nested blocks, in document order", () => {
    const doc = [
      withChildren(block("p", "bulletListItem", "Budget"), [block("c", "bulletListItem", "40h", { backgroundColor: ENHANCE_MARK_ADDED })]),
      block("q", "paragraph", "Next", { backgroundColor: ENHANCE_MARK_ADDED }),
    ];
    expect(findEnhanceMarks(doc).map((m) => m.id)).toEqual(["c", "q"]);
  });

  it("hasEnhanceMarks sees a mark that is only on a nested block", () => {
    const doc = [withChildren(block("p", "bulletListItem", "Budget"), [block("c", "bulletListItem", "40h", { backgroundColor: ENHANCE_MARK_PRIOR })])];
    expect(hasEnhanceMarks(doc)).toBe(true);
    expect(hasEnhanceMarks([block("p", "paragraph", "x")])).toBe(false);
  });

  it("appendChildren sets a childless parent's children, tinted enhance-added", () => {
    const editor = fakeEditor([block("p", "bulletListItem", "Budget")]);
    const ops: EditorOp[] = [
      { kind: "appendChildren", parentId: "p", blocks: [{ type: "bulletListItem", text: "40h", cites: [], added: true }] },
    ];
    renderEnhanceOps(editor, ops, { notePath: "/documents/p1", recordingId: "rec1" });
    const children = editor.getBlock("p")!.children as unknown as { type: string; props: { backgroundColor: string } }[];
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ type: "bulletListItem", props: { backgroundColor: ENHANCE_MARK_ADDED } });
  });

  it("appendChildren inserts after the parent's last existing child", () => {
    const last = block("c2", "bulletListItem", "second");
    const editor = fakeEditor([withChildren(block("p", "bulletListItem", "Budget"), [block("c1", "bulletListItem", "first"), last])]);
    const insertBlocks = vi.spyOn(editor, "insertBlocks");
    const ops: EditorOp[] = [
      { kind: "appendChildren", parentId: "p", blocks: [{ type: "bulletListItem", text: "third", cites: [], added: true }] },
    ];
    renderEnhanceOps(editor, ops, { notePath: "/documents/p1", recordingId: "rec1" });
    expect(insertBlocks).toHaveBeenCalledWith([expect.objectContaining({ type: "bulletListItem" })], last, "after");
  });

  it("appendChildren is a no-op when the parent is gone", () => {
    const editor = fakeEditor([block("q", "paragraph", "Other")]);
    const ops: EditorOp[] = [{ kind: "appendChildren", parentId: "p", blocks: [{ type: "paragraph", text: "x", cites: [], added: true }] }];
    renderEnhanceOps(editor, ops, { notePath: "/documents/p1", recordingId: "rec1" });
    expect(editor.document.map((b) => b.id)).toEqual(["q"]);
  });

  it("revert restores a changed block's content but leaves its current children alone", () => {
    const prior = withChildren(block("p", "bulletListItem", "Budget"), []);
    const added = block("c", "bulletListItem", "40h", { backgroundColor: ENHANCE_MARK_ADDED });
    const editor = fakeEditor([withChildren(block("p", "bulletListItem", "Budget: 40h", { backgroundColor: ENHANCE_MARK_ADDED }), [added])]);
    revertEnhanceBlock(editor, "p", { p: prior });
    const reverted = editor.getBlock("p")!;
    expect(reverted.content).toEqual([{ type: "text", text: "Budget", styles: {} }]);
    expect(reverted.children).toEqual([added]);
  });
});

describe("renderEnhanceOps appendAtEnd", () => {
  const items: EnhanceOpBlock[] = [{ type: "heading", text: "Action items", cites: [], added: true }];
  const ctx = { notePath: "/documents/p1", recordingId: "rec1" };

  it("goes directly above the Transcript toggle, even with notes below the toggle", () => {
    const toggle = { ...(transcriptToggleBlock(["Ada: hi"]) as unknown as DocBlock), id: "t" } as DocBlock;
    const editor = fakeEditor([block("a", "paragraph", "Notes"), toggle, block("z", "paragraph", "After")]);
    renderEnhanceOps(editor, [{ kind: "appendAtEnd", blocks: items }], ctx);
    const ids = editor.document.map((b) => b.id);
    expect(ids.indexOf("t")).toBe(ids.length - 2);
    expect(editor.document[ids.length - 3]!.type).toBe("heading");
  });

  it("goes at the very end when there is no Transcript toggle yet", () => {
    const editor = fakeEditor([block("a", "paragraph", "Notes")]);
    renderEnhanceOps(editor, [{ kind: "appendAtEnd", blocks: items }], ctx);
    expect(editor.document).toHaveLength(2);
    expect(editor.document[1]!.type).toBe("heading");
  });
});
