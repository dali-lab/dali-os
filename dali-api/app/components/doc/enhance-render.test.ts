import { describe, expect, it } from "vitest";
import {
  buildInlineContent,
  enhanceSnapshotBlocks,
  findTranscriptToggle,
  formatChipLabel,
  transcriptToggleBlock,
} from "./enhance-render";
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

describe("formatChipLabel", () => {
  it("is the timestamp alone without a speaker", () => {
    expect(formatChipLabel(842)).toBe("14:02");
    expect(formatChipLabel(5)).toBe("0:05");
    expect(formatChipLabel(-3)).toBe("0:00");
  });
  it("leads with the speaker's first name when known", () => {
    expect(formatChipLabel(842, "Maya")).toBe("Maya · 14:02");
  });
  it("ignores an empty speaker", () => {
    expect(formatChipLabel(842, null)).toBe("14:02");
    expect(formatChipLabel(842, "")).toBe("14:02");
  });
});

describe("buildInlineContent citation chips", () => {
  const links = (content: unknown) =>
    (content as Array<{ type: string; content?: string; href?: string }>).filter((c) => c.type === "link");

  it("labels each chip with the speaker at that second", () => {
    const speakerAt = (at: number) => (at === 842 ? "Maya" : null);
    const chips = links(buildInlineContent("Text", [842, 900], "/documents/p1", "r1", speakerAt));
    expect(chips.map((c) => c.content)).toEqual(["Maya · 14:02", "15:00"]);
    expect(chips[0]!.href).toBe("/documents/p1?transcript=r1&at=842");
  });

  it("keeps plain timestamps when no resolver is given", () => {
    expect(links(buildInlineContent("Text", [842], "/documents/p1", "r1")).map((c) => c.content)).toEqual(["14:02"]);
  });

  it("links each chip back to the page hosting the note", () => {
    const [chip] = links(buildInlineContent("Text", [60], "/hiring/interviews/i1", "r1"));
    expect(chip!.href).toBe("/hiring/interviews/i1?transcript=r1&at=60");
  });
});
