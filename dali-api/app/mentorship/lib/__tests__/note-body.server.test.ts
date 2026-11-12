import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/collab/read", () => ({ readDocAsBlocks: vi.fn() }));

import { readDocAsBlocks } from "~/collab/read";
import { readMentorNoteBlocks } from "../note-body.server";

const BLOCKS = [{ type: "paragraph", content: "from the room" }];

beforeEach(() => vi.resetAllMocks());

describe("readMentorNoteBlocks", () => {
  it("reads the page's room", async () => {
    vi.mocked(readDocAsBlocks).mockResolvedValue(BLOCKS as never);

    expect(await readMentorNoteBlocks({ pageId: "p1" })).toEqual(BLOCKS);
    expect(readDocAsBlocks).toHaveBeenCalledWith("doc:p1:body");
  });

  it("reads a note with no page as an empty document", async () => {
    expect(await readMentorNoteBlocks({ pageId: null })).toEqual([]);
    expect(readDocAsBlocks).not.toHaveBeenCalled();
  });
});
