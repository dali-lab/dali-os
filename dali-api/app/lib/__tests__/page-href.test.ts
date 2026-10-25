import { describe, expect, it } from "vitest";
import { pageOpenHref } from "~/lib/page-href";

describe("pageOpenHref", () => {
  it("opens whiteboards on the canvas", () => {
    expect(pageOpenHref("Whiteboard", "p1")).toBe("/whiteboard/p1");
  });

  it("opens slide decks on the deck surface", () => {
    expect(pageOpenHref("Slides", "p1")).toBe("/slides/p1");
  });

  it("opens every other kind in the document editor", () => {
    for (const kind of ["FreeForm", "Structured", "Notebook", "Folder", undefined, null]) {
      expect(pageOpenHref(kind, "p1")).toBe("/documents/p1");
    }
  });
});
