import { describe, it, expect } from "vitest";
import { revealInDriveHref } from "~/drive/lib/drive-crumbs";

describe("revealInDriveHref", () => {
  it("points at the reveal route for the page", () => {
    expect(revealInDriveHref("page_1")).toBe("/drive/reveal/page_1");
  });
});
