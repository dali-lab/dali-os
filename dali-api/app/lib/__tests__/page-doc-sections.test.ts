import { describe, expect, it } from "vitest";
import {
  mergeSectionsPayload,
  parseStoredSections,
  resolveSections,
} from "~/lib/page-doc-sections";

describe("page-doc-sections", () => {
  it("synthesizes Overview from legacy body/videoKey when sections empty", () => {
    const sections = resolveSections({
      body: { type: "doc", content: [] },
      videoKey: "page-docs/abc.mp4",
      sections: null,
    });
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      id: "overview",
      title: "Overview",
      videoKey: "page-docs/abc.mp4",
    });
  });

  it("prefers stored sections over legacy fields", () => {
    const sections = resolveSections({
      body: null,
      videoKey: "legacy",
      sections: [
        { id: "a", title: "Start", body: { x: 1 }, videoKey: "a.mp4" },
        { id: "b", title: "Next", body: null, videoKey: null },
      ],
    });
    expect(sections.map((s) => s.title)).toEqual(["Start", "Next"]);
    expect(sections[0]?.videoKey).toBe("a.mp4");
  });

  it("parses malformed rows defensively", () => {
    expect(parseStoredSections([null, "x", { title: "  Ok  " }])).toEqual([
      expect.objectContaining({ title: "Ok", videoKey: null }),
    ]);
  });

  it("merges videoKey: omit keeps prior, null clears, string sets", () => {
    const prior = [
      { id: "a", title: "A", body: 1, videoKey: "keep.mp4" },
      { id: "b", title: "B", body: 2, videoKey: "old.mp4" },
    ];
    const merged = mergeSectionsPayload(
      [
        { id: "a", title: "A", body: 1 },
        { id: "b", title: "B2", body: 2, videoKey: null },
        { title: "New", body: null, videoKey: "new.mp4" },
      ],
      prior,
    );
    expect(merged).not.toHaveProperty("error");
    if ("error" in merged) return;
    expect(merged[0]?.videoKey).toBe("keep.mp4");
    expect(merged[1]).toMatchObject({ title: "B2", videoKey: null });
    expect(merged[2]).toMatchObject({ title: "New", videoKey: "new.mp4" });
    expect(merged[2]?.id).toMatch(/^sec_/);
  });

  it("rejects empty sections payload", () => {
    expect(mergeSectionsPayload([], [])).toEqual({
      error: "Add at least one section.",
    });
  });
});
