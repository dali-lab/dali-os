import { describe, it, expect, vi } from "vitest";

// The functions under test are pure, but ~/lib/mentions imports prisma +
// notify at module load; mock them so the test doesn't pull in the generated
// client (absent in the CI test job — matches the repo-wide pattern).
vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import {
  extractHandlesFromText,
  extractMentionUserIds,
  pageDocLink,
} from "~/lib/mentions";

describe("extractHandlesFromText", () => {
  it("pulls bare @handles, lowercased and deduped", () => {
    expect(extractHandlesFromText("hey @spark and @JSmith and @spark")).toEqual([
      "spark",
      "jsmith",
    ]);
  });

  it("returns nothing when there are no mentions", () => {
    expect(extractHandlesFromText("no mentions here")).toEqual([]);
  });

  it("handles underscores but stops at punctuation", () => {
    expect(extractHandlesFromText("ping @a_b, done")).toEqual(["a_b"]);
  });
});

describe("extractMentionUserIds", () => {
  it("collects user ids from mention nodes, deduped", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "hi " },
            { type: "mention", attrs: { id: "u1", label: "spark" } },
            { type: "mention", attrs: { id: "u2", label: "jsmith" } },
            { type: "mention", attrs: { id: "u1", label: "spark" } },
          ],
        },
      ],
    };
    expect(extractMentionUserIds(doc).sort()).toEqual(["u1", "u2"]);
  });

  it("returns nothing for a doc with no mentions or malformed input", () => {
    expect(extractMentionUserIds({ type: "doc", content: [] })).toEqual([]);
    expect(extractMentionUserIds(null)).toEqual([]);
    expect(extractMentionUserIds("nope")).toEqual([]);
  });
});

describe("pageDocLink", () => {
  it("appends ?doc=1 to a clean relative path", () => {
    expect(pageDocLink("/mentorship")).toBe("/mentorship?doc=1");
  });

  it("uses & when the path already has a query", () => {
    expect(pageDocLink("/mentorship?term=26S")).toBe("/mentorship?term=26S&doc=1");
  });

  it("rejects absolute or protocol-relative paths", () => {
    expect(pageDocLink("https://evil.com")).toBe("/");
    expect(pageDocLink("//evil.com")).toBe("/");
    expect(pageDocLink(undefined)).toBe("/");
  });
});
