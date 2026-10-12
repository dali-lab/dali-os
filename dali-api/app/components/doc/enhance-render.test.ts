import { describe, expect, it } from "vitest";
import { enhanceSnapshotBlocks, findTranscriptToggle, transcriptToggleBlock } from "./enhance-render";
import type { DocBlock } from "./schema/build";

function heading(id: string, text: string, isToggleable = false): DocBlock {
  return {
    id,
    type: "heading",
    props: { level: 2, isToggleable },
    content: [{ type: "text", text, styles: {} }],
    children: [],
  } as unknown as DocBlock;
}

function paragraph(id: string, text: string): DocBlock {
  return { id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] } as unknown as DocBlock;
}

describe("enhanceSnapshotBlocks", () => {
  it("drops the Transcript toggle so Enhance never anchors notes below the inserted transcript", () => {
    const toggle = { ...transcriptToggleBlock(["Ada: hi"]), id: "t" } as unknown as DocBlock;
    const doc = [heading("h1", "Agenda"), paragraph("p1", "Ship it"), toggle];
    expect(findTranscriptToggle(doc)).toBe(toggle);
    expect(enhanceSnapshotBlocks(doc)).toEqual([
      { id: "h1", type: "heading", text: "Agenda" },
      { id: "p1", type: "paragraph", text: "Ship it" },
    ]);
  });

  it("keeps a plain Transcript heading that is not a toggle", () => {
    const doc = [heading("h1", "Transcript"), paragraph("p1", "notes")];
    expect(enhanceSnapshotBlocks(doc).map((b) => b.id)).toEqual(["h1", "p1"]);
  });
});
