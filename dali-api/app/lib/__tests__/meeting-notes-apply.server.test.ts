// Server-side replay of applyEnhancePlan's ops against DocBlock JSON — the
// MCP enhance_meeting_notes apply path's counterpart to renderEnhanceOps.

import { describe, it, expect } from "vitest";
import type { DocBlock } from "~/collab/blocknote-server";
import type { EditorOp } from "~/components/meeting-recorder/enhance-plan";
import { applyEnhanceOpsToDocBlocks, ensureTranscriptToggle, hasTranscriptToggle } from "~/lib/meeting-notes-apply.server";

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
