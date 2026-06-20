import { describe, it, expect } from "vitest";
import { extractHandles, pickCandidate, resolveMentions, segmentBody } from "~/lib/mentions";

const candidates = [
  { id: "u1", firstName: "Kiran", lastName: "Jones" },
  { id: "u2", firstName: "Ashna", lastName: "Ghanate" },
  { id: "u3", firstName: "Kiran", lastName: "Patel" }, // ambiguous firstName
];

describe("extractHandles", () => {
  it("returns each handle once in order", () => {
    expect(extractHandles("hey @ashna and @ashna and @kiran-jones")).toEqual([
      "ashna",
      "kiran-jones",
    ]);
  });

  it("returns empty for text without mentions", () => {
    expect(extractHandles("nothing here")).toEqual([]);
  });
});

describe("pickCandidate", () => {
  it("matches firstName+lastName composite", () => {
    expect(pickCandidate("kiran-jones", candidates)?.id).toBe("u1");
  });

  it("matches firstName-only when unique", () => {
    expect(pickCandidate("ashna", candidates)?.id).toBe("u2");
  });

  it("returns null when firstName-only is ambiguous", () => {
    expect(pickCandidate("kiran", candidates)).toBeNull();
  });

  it("returns null on unknown handle", () => {
    expect(pickCandidate("nobody", candidates)).toBeNull();
  });
});

describe("resolveMentions", () => {
  it("dedupes mentions of the same user", () => {
    const mentions = resolveMentions(
      "@ashna please look at @ashna's PR — also @kiran-jones",
      candidates,
    );
    expect(mentions.map((m) => m.userId).sort()).toEqual(["u1", "u2"]);
  });
});

describe("segmentBody", () => {
  it("preserves text and inserts mention segments", () => {
    const mentions = resolveMentions("hi @ashna how are you", candidates);
    const segments = segmentBody("hi @ashna how are you", mentions);
    expect(segments).toEqual([
      { type: "text", text: "hi " },
      { type: "mention", text: "@Ashna Ghanate", userId: "u2" },
      { type: "text", text: " how are you" },
    ]);
  });

  it("falls through unresolved handles as raw text segments", () => {
    const segments = segmentBody("hi @stranger", []);
    expect(segments).toEqual([
      { type: "text", text: "hi " },
      { type: "mention", text: "@stranger", userId: undefined },
    ]);
  });
});
