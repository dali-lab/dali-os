// Unit tests for the doc package's pure helpers (node environment — no DOM,
// no BlockNote imports).

import { describe, expect, it, vi } from "vitest";
import {
  countWords,
  extractHeadings,
  insertItemIntoGroup,
  looksLikeProseMirrorDoc,
  normalizeInitialContent,
} from "../blocks-util";
import { EDITOR_PRESETS, hasSigning, resolveFeatures } from "../features";
import { blocksToPlainText } from "../schema/configs";

const sampleBlocks = [
  { type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Title" }] },
  {
    type: "paragraph",
    content: [
      { type: "text", text: "Hello " },
      { type: "mention", props: { id: "u1", label: "ada" } },
      { type: "text", text: " world" },
    ],
  },
  {
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "Section" }],
    children: [
      { type: "heading", props: { level: 3 }, content: [{ type: "text", text: "Nested" }] },
      { type: "heading", props: { level: 4 }, content: [{ type: "text", text: "TooDeep" }] },
    ],
  },
  {
    type: "table",
    content: {
      type: "tableContent",
      rows: [{ cells: [[{ type: "text", text: "a" }], [{ type: "text", text: "b" }]] }],
    },
  },
];

describe("resolveFeatures", () => {
  it("resolves preset names to the legacy preset shapes", () => {
    expect(resolveFeatures("document")).toEqual({ mentions: true, images: true, richBlocks: true });
    expect(resolveFeatures("agreement")).toEqual({ images: true, signing: true });
    expect(resolveFeatures("field")).toEqual({});
  });

  it("passes feature objects through and defaults to {}", () => {
    const custom = { mentions: true };
    expect(resolveFeatures(custom)).toBe(custom);
    expect(resolveFeatures(undefined)).toEqual({});
  });

  it("coerces the legacy structured signing shape", () => {
    expect(hasSigning({ signing: { variables: { term: "26S" } } })).toBe(true);
    expect(hasSigning(EDITOR_PRESETS.agreement)).toBe(true);
    expect(hasSigning({})).toBe(false);
  });
});

describe("countWords / extractHeadings", () => {
  it("counts words across inline text, mentions, and tables", () => {
    // "Title" + "Hello @ada world" + "Section" + "Nested" + "TooDeep" + "a b"
    expect(countWords(sampleBlocks)).toBe(9);
    expect(countWords([])).toBe(0);
    expect(countWords(undefined)).toBe(0);
  });

  it("extracts the H1–H3 outline in traversal order with ordinals", () => {
    expect(extractHeadings(sampleBlocks)).toEqual([
      { level: 1, text: "Title", ordinal: 0 },
      { level: 2, text: "Section", ordinal: 1 },
      { level: 3, text: "Nested", ordinal: 2 },
    ]);
  });

  it("does not leak child-block text into a heading's own text", () => {
    const [, section] = [null, extractHeadings(sampleBlocks)[1]];
    expect(section.text).toBe("Section");
  });

  it("defaults heading level to 1 when props are absent", () => {
    expect(extractHeadings([{ type: "heading", content: [{ type: "text", text: "X" }] }])).toEqual([
      { level: 1, text: "X", ordinal: 0 },
    ]);
  });
});

describe("normalizeInitialContent", () => {
  it("passes non-empty block arrays through", () => {
    const blocks = [{ type: "paragraph" }];
    expect(normalizeInitialContent(blocks)).toBe(blocks);
  });

  it("returns undefined for null/undefined/empty arrays (BlockNote throws on [])", () => {
    expect(normalizeInitialContent(undefined)).toBeUndefined();
    expect(normalizeInitialContent(null)).toBeUndefined();
    expect(normalizeInitialContent([])).toBeUndefined();
  });

  it("detects legacy ProseMirror JSON, warns, and renders empty", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pmDoc = { type: "doc", content: [{ type: "paragraph" }] };
    expect(looksLikeProseMirrorDoc(pmDoc)).toBe(true);
    expect(normalizeInitialContent(pmDoc)).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("rejects other non-array shapes with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(normalizeInitialContent("nope")).toBeUndefined();
    expect(normalizeInitialContent({ html: "<p>x</p>" })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("insertItemIntoGroup", () => {
  const items = [
    { key: "heading", group: "Headings" },
    { key: "paragraph", group: "Basic blocks" },
    { key: "divider", group: "Basic blocks" },
    { key: "table", group: "Advanced" },
  ];

  it("splices the item after the last member of its group (no duplicate group runs)", () => {
    const out = insertItemIntoGroup(items, { key: "callout", group: "Basic blocks" });
    expect(out.map((i) => i.key)).toEqual(["heading", "paragraph", "divider", "callout", "table"]);
    // Contiguous group runs — the shadcn menu renders one header per run, so a
    // group name must never appear in two separate runs (the spike's duplicate
    // React key bug).
    const runs: string[] = [];
    for (const item of out) {
      if (runs[runs.length - 1] !== item.group) runs.push(item.group);
    }
    expect(new Set(runs).size).toBe(runs.length);
  });

  it("appends when the group is absent and does not mutate the input", () => {
    const out = insertItemIntoGroup(items, { key: "callout", group: "Custom" });
    expect(out[out.length - 1].key).toBe("callout");
    expect(items).toHaveLength(4);
  });
});

describe("blocksToPlainText (shared contract)", () => {
  it("renders mentions as @handle and flattens tables", () => {
    expect(blocksToPlainText(sampleBlocks as never)).toBe(
      "Title\nHello @ada world\nSection\nNested\nTooDeep\na b",
    );
  });
});
