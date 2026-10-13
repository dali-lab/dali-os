import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/collab/read", () => ({ readDocAsBlocks: vi.fn() }));

import { readDocAsBlocks } from "~/collab/read";
import { readMentorNoteBlocks } from "../note-body.server";

const BLOCKS = [{ type: "paragraph", content: "from the room" }];

beforeEach(() => vi.resetAllMocks());

describe("readMentorNoteBlocks", () => {
  it("reads the page's room once the note has a page, ignoring contentJson", async () => {
    vi.mocked(readDocAsBlocks).mockResolvedValue(BLOCKS as never);

    const out = await readMentorNoteBlocks({ pageId: "p1", contentJson: [{ type: "paragraph", content: "stale" }] });

    expect(readDocAsBlocks).toHaveBeenCalledWith("doc:p1:body");
    expect(out).toEqual(BLOCKS);
  });

  it("falls back to contentJson as blocks when there is no page", async () => {
    const out = await readMentorNoteBlocks({ pageId: null, contentJson: BLOCKS });

    expect(readDocAsBlocks).not.toHaveBeenCalled();
    expect(out).toEqual(BLOCKS);
  });

  it("maps legacy ProseMirror contentJson when there is no page", async () => {
    const pm = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Legacy" }] }] };

    const out = await readMentorNoteBlocks({ pageId: null, contentJson: pm });

    expect(JSON.stringify(out)).toContain("Legacy");
  });

  it("reads an empty page as an empty document, not the stale contentJson", async () => {
    vi.mocked(readDocAsBlocks).mockResolvedValue([]);

    expect(await readMentorNoteBlocks({ pageId: "p1", contentJson: BLOCKS })).toEqual([]);
  });
});
