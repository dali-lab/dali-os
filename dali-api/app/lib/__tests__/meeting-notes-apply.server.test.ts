// Server-side replay of applyEnhancePlan's ops against DocBlock JSON — the
// MCP enhance_meeting_notes apply path's counterpart to renderEnhanceOps.

import { describe, it, expect } from "vitest";
import type { DocBlock } from "~/collab/blocknote-server";
import type { EditorOp } from "~/components/meeting-recorder/enhance-plan";
import {
  applyEnhanceOpsToDocBlocks,
  enhanceSnapshotDocBlocks,
  ensureTranscriptToggle,
  hasEnhanceMarkInTree,
  hasTranscriptToggle,
} from "~/lib/meeting-notes-apply.server";

const CTX = { pageId: "p1", recordingId: "rec1" };

function paragraph(id: string, text: string): DocBlock {
  return { id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] };
}

describe("applyEnhanceOpsToDocBlocks", () => {
  it("replaces an update op's content, leaving type/props/children untouched", () => {
    const blocks = [{ ...paragraph("b1", "old"), props: { custom: true }, children: [paragraph("child", "c")] }];
    const ops: EditorOp[] = [{ kind: "update", id: "b1", text: "new text", cites: [12] }];

    const result = applyEnhanceOpsToDocBlocks(ops, blocks, CTX);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("b1");
    expect(result[0]!.props).toEqual({ custom: true });
    expect(result[0]!.children).toHaveLength(1);
    expect(JSON.stringify(result[0]!.content)).toContain("new text");
    expect(JSON.stringify(result[0]!.content)).toContain("at=12"); // citation chip href
  });

  it("labels citation chips with the resolver's speaker, for updates and inserts", () => {
    const speakerAt = (at: number) => (at === 12 ? "Maya" : null);
    const blocks = [paragraph("b1", "old")];
    const ops: EditorOp[] = [
      { kind: "update", id: "b1", text: "new", cites: [12, 90] },
      { kind: "insertAfter", afterId: "b1", blocks: [{ type: "bulletListItem", text: "Ship it", cites: [12], added: true }] },
    ];
    const result = applyEnhanceOpsToDocBlocks(ops, blocks, { ...CTX, speakerAt });
    const updated = JSON.stringify(result[0]!.content);
    expect(updated).toContain("Maya");
    expect(JSON.stringify(result[1]!.content)).toContain("Maya");
    expect(updated.match(/Maya/g)).toHaveLength(1);
  });

  it("leaves non-matching blocks alone for an update op", () => {
    const blocks = [paragraph("b1", "a"), paragraph("b2", "b")];
    const ops: EditorOp[] = [{ kind: "update", id: "b1", text: "changed", cites: [] }];
    const result = applyEnhanceOpsToDocBlocks(ops, blocks, CTX);
    expect(result[1]).toEqual(blocks[1]);
  });

  it("removes a block by id", () => {
    const blocks = [paragraph("b1", "a"), paragraph("b2", "b")];
    const ops: EditorOp[] = [{ kind: "remove", id: "b1" }];
    const result = applyEnhanceOpsToDocBlocks(ops, blocks, CTX);
    expect(result.map((b) => b.id)).toEqual(["b2"]);
  });

  it("inserts new blocks after the named anchor, each with a fresh id", () => {
    const blocks = [paragraph("b1", "a"), paragraph("b2", "b")];
    const ops: EditorOp[] = [
      {
        kind: "insertAfter",
        afterId: "b1",
        blocks: [
          { type: "heading", text: "Decisions", cites: [], added: true },
          { type: "bulletListItem", text: "Ship it", cites: [5], added: true },
        ],
      },
    ];
    const result = applyEnhanceOpsToDocBlocks(ops, blocks, CTX);
    expect(result.map((b) => b.id)).toEqual(["b1", expect.any(String), expect.any(String), "b2"]);
    expect(result[1]!.type).toBe("heading");
    expect(result[1]!.props).toEqual({ level: 2 });
    expect(result[2]!.type).toBe("bulletListItem");
  });

  it("renders a checkListItem insert as an unchecked checklist block (action items, §4)", () => {
    const blocks = [paragraph("b1", "a")];
    const ops: EditorOp[] = [
      { kind: "insertAfter", afterId: "b1", blocks: [{ type: "checkListItem", text: "Send the scope", cites: [1], added: true }] },
    ];
    const result = applyEnhanceOpsToDocBlocks(ops, blocks, CTX);
    expect(result[1]!.type).toBe("checkListItem");
    expect(result[1]!.props).toEqual({ checked: false });
  });

  it("links a checkListItem insert to an already-created task (Create tasks ran before Apply, §4)", () => {
    const blocks = [paragraph("b1", "a")];
    const ops: EditorOp[] = [
      {
        kind: "insertAfter",
        afterId: "b1",
        blocks: [{ type: "checkListItem", text: "Send the revised scope", cites: [], added: true }],
      },
    ];
    const result = applyEnhanceOpsToDocBlocks(ops, blocks, {
      ...CTX,
      actionItems: [{ text: "Send the revised scope", taskId: "task1" }],
      projectId: "proj1",
    });
    expect(JSON.stringify(result[1]!.content)).toContain("taskMention");
    expect(JSON.stringify(result[1]!.content)).toContain("task1");
  });

  it("inserts at the start when afterId is null", () => {
    const blocks = [paragraph("b1", "a")];
    const ops: EditorOp[] = [
      { kind: "insertAfter", afterId: null, blocks: [{ type: "paragraph", text: "first", cites: [], added: true }] },
    ];
    const result = applyEnhanceOpsToDocBlocks(ops, blocks, CTX);
    expect(result).toHaveLength(2);
    expect(JSON.stringify(result[0]!.content)).toContain("first");
    expect(result[1]!.id).toBe("b1");
  });

  it("falls back to appending when the anchor no longer exists", () => {
    const blocks = [paragraph("b1", "a")];
    const ops: EditorOp[] = [
      { kind: "insertAfter", afterId: "gone", blocks: [{ type: "paragraph", text: "x", cites: [], added: true }] },
    ];
    const result = applyEnhanceOpsToDocBlocks(ops, blocks, CTX);
    expect(result).toHaveLength(2);
    expect(result[1]!.id).not.toBe("b1");
  });
});

describe("hasTranscriptToggle / ensureTranscriptToggle", () => {
  it("reports no toggle on an ordinary doc", () => {
    expect(hasTranscriptToggle([paragraph("b1", "a")])).toBe(false);
  });

  it("recognizes an existing toggle by heading text + isToggleable", () => {
    const toggle: DocBlock = {
      id: "t1",
      type: "heading",
      props: { level: 3, isToggleable: true },
      content: [{ type: "text", text: "Transcript", styles: {} }],
      children: [],
    };
    expect(hasTranscriptToggle([paragraph("b1", "a"), toggle])).toBe(true);
  });

  it("appends a toggle with one paragraph per transcript line when absent", () => {
    const blocks = [paragraph("b1", "a")];
    const result = ensureTranscriptToggle(blocks, ["You: hello", "Others: hi"]);
    expect(result).toHaveLength(2);
    expect(result[1]!.type).toBe("heading");
    expect(result[1]!.children).toHaveLength(2);
    expect(hasTranscriptToggle(result)).toBe(true);
  });

  it("is a no-op when a toggle already exists, never appending twice", () => {
    const blocks = ensureTranscriptToggle([paragraph("b1", "a")], ["line"]);
    const result = ensureTranscriptToggle(blocks, ["line"]);
    expect(result).toBe(blocks);
    expect(result.filter((b) => b.type === "heading")).toHaveLength(1);
  });

  it("is a no-op with no transcript to insert", () => {
    const blocks = [paragraph("b1", "a")];
    expect(ensureTranscriptToggle(blocks, [])).toBe(blocks);
  });
});

describe("applyEnhanceOpsToDocBlocks on nested blocks", () => {
  const nested = () => [{ ...paragraph("p", "Budget"), children: [paragraph("c", "40h")] }, paragraph("q", "Next")];

  it("updates a nested block's content", () => {
    const result = applyEnhanceOpsToDocBlocks([{ kind: "update", id: "c", text: "40h for spring", cites: [] }], nested(), CTX);
    expect(JSON.stringify(result[0]!.children[0]!.content)).toContain("40h for spring");
  });

  it("appendChildren adds the new blocks after the parent's existing children", () => {
    const ops: EditorOp[] = [{ kind: "appendChildren", parentId: "p", blocks: [{ type: "bulletListItem", text: "approved", cites: [], added: true }] }];
    const result = applyEnhanceOpsToDocBlocks(ops, nested(), CTX);
    expect(result[0]!.children.map((b) => b.type)).toEqual(["paragraph", "bulletListItem"]);
    expect(JSON.stringify(result[0]!.children[1]!.content)).toContain("approved");
  });

  it("insertAfter a nested block inserts a sibling at that depth", () => {
    const ops: EditorOp[] = [{ kind: "insertAfter", afterId: "c", blocks: [{ type: "paragraph", text: "sibling", cites: [], added: true }] }];
    const result = applyEnhanceOpsToDocBlocks(ops, nested(), CTX);
    expect(result).toHaveLength(2);
    expect(result[0]!.children).toHaveLength(2);
  });

  it("insertAfter a missing anchor appends at the end", () => {
    const ops: EditorOp[] = [{ kind: "insertAfter", afterId: "gone", blocks: [{ type: "paragraph", text: "x", cites: [], added: true }] }];
    expect(applyEnhanceOpsToDocBlocks(ops, nested(), CTX)).toHaveLength(3);
  });

  it("remove drops a nested block", () => {
    const result = applyEnhanceOpsToDocBlocks([{ kind: "remove", id: "c" }], nested(), CTX);
    expect(result[0]!.children).toEqual([]);
  });
});

describe("enhanceSnapshotDocBlocks / hasEnhanceMarkInTree", () => {
  it("flattens the tree and leaves out the Transcript toggle and its lines", () => {
    const withToggle = ensureTranscriptToggle([{ ...paragraph("p", "Budget"), children: [paragraph("c", "40h")] }], ["Ada: hi"]);
    expect(enhanceSnapshotDocBlocks(withToggle)).toEqual([
      { id: "p", type: "paragraph", text: "Budget" },
      { id: "c", type: "paragraph", text: "40h", parentId: "p" },
    ]);
  });

  it("finds a reserved mark at any depth, and ignores other colors", () => {
    const marked = { ...paragraph("c", "40h"), props: { backgroundColor: "enhance-added" } };
    expect(hasEnhanceMarkInTree([{ ...paragraph("p", "Budget"), children: [marked] }])).toBe(true);
    expect(hasEnhanceMarkInTree([{ ...paragraph("p", "Budget"), props: { backgroundColor: "red" } }])).toBe(false);
  });
});

describe("applyEnhanceOpsToDocBlocks appendAtEnd", () => {
  const op: EditorOp = { kind: "appendAtEnd", blocks: [{ type: "heading", text: "Action items", cites: [], added: true }] };

  it("goes directly above an existing Transcript toggle", () => {
    const doc = ensureTranscriptToggle([paragraph("a", "Notes")], ["Ada: hi"]);
    const result = applyEnhanceOpsToDocBlocks([op], doc, CTX);
    expect(result.map((b) => b.type)).toEqual(["paragraph", "heading", "heading"]);
    expect(hasTranscriptToggle([result[2]!])).toBe(true);
  });

  it("goes at the end when there is no toggle, so ensureTranscriptToggle lands below it", () => {
    const result = ensureTranscriptToggle(applyEnhanceOpsToDocBlocks([op], [paragraph("a", "Notes")], CTX), ["Ada: hi"]);
    expect(JSON.stringify(result[1]!.content)).toContain("Action items");
    expect(hasTranscriptToggle([result[2]!])).toBe(true);
  });
});
