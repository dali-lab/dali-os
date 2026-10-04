import { describe, it, expect } from "vitest";
import { deepLinkTabLabel } from "~/lib/deep-link-tab";

describe("deepLinkTabLabel", () => {
  it("prefers the sidebar's own label for a path the nav owns", () => {
    expect(deepLinkTabLabel("Drive", "My folder · DALI OS", "/drive")).toBe("Drive");
  });

  it("falls back to the entry page's title, suffix stripped", () => {
    expect(deepLinkTabLabel(undefined, "Winter Retreat · DALI OS", "/documents/clx1")).toBe(
      "Winter Retreat",
    );
  });

  // The whole point: a document/file/whiteboard/profile url has no nav label, and
  // without SOME label the workspace used to seed no tab at all and the deep link
  // landed on Home.
  it("always returns a label, so a nav-less deep link is still seeded", () => {
    expect(deepLinkTabLabel(undefined, undefined, "/documents/clx1")).toBe("Documents");
    expect(deepLinkTabLabel(undefined, "DALI OS", "/whiteboard/clx1")).toBe("Whiteboard");
    expect(deepLinkTabLabel(undefined, "", "/intent-to-work")).toBe("Intent To Work");
    expect(deepLinkTabLabel(undefined, undefined, "/")).toBe("Page");
  });
});
