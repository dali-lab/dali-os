import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));

import { blocksForPrompt } from "~/lib/meeting-notes-enhance.server";

describe("blocksForPrompt", () => {
  it("lists top-level blocks as [id] (type) text", () => {
    expect(blocksForPrompt([{ id: "a", type: "heading", text: "Budget" }])).toBe("[a] (heading) Budget");
  });

  it("indents nested blocks by depth and names their parent", () => {
    expect(
      blocksForPrompt([
        { id: "a", type: "bulletListItem", text: "Hours" },
        { id: "b", type: "bulletListItem", text: "40h", parentId: "a" },
        { id: "c", type: "paragraph", text: "spring", parentId: "b" },
        { id: "d", type: "paragraph", text: "Next" },
      ]),
    ).toBe(
      [
        "[a] (bulletListItem) Hours",
        "  [b] (bulletListItem, under a) 40h",
        "    [c] (paragraph, under b) spring",
        "[d] (paragraph) Next",
      ].join("\n"),
    );
  });

  it("is empty for a note with no blocks", () => {
    expect(blocksForPrompt([])).toBe("");
  });
});
