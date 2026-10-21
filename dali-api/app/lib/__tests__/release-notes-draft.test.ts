import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  bodyToBlocks,
  buildDraftPrompt,
  chunk,
  decideCursor,
  parseDraftEntries,
  pickCaptureVideoKey,
  selectPrsToDraft,
  stripEmDashes,
  DRAFT_SYSTEM_PROMPT,
  type PullSummary,
} from "../release-notes-draft";
import { releaseNoteLine } from "../release-note-line";

const pr = (n: number, o: Partial<PullSummary> = {}): PullSummary => ({
  number: n,
  title: `PR ${n}`,
  body: "",
  labels: [],
  mergedAt: "2026-10-20T00:00:00Z",
  baseRef: "staging",
  ...o,
});
const none = new Set<number>();
const sel = (prs: PullSummary[], cited = none) =>
  selectPrsToDraft(prs, { citedPrNumbers: cited, promotionBranch: "prod" });

const TEMPLATE = [
  "## Summary",
  "",
  "<!-- What changed and why. -->",
  "Refactor.",
  "",
  "## Release note",
  "",
  "<!-- Leave empty unless a member would care. -->",
  "",
].join("\n");

describe("releaseNoteLine", () => {
  it("reads the text under the heading", () => {
    expect(releaseNoteLine(`${TEMPLATE}You can hold a room from an event.\n`)).toBe(
      "You can hold a room from an event.",
    );
  });

  const FOOTER = [
    "",
    "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
    "",
    "<!-- codesmith:footer -->",
    "---",
    '<a href="https://app.blacksmith.sh/x"><img alt="View with [code]smith"></a>',
    "<sup>Need help on this PR? Tag <code>@codesmith-bot</code> with what you need.</sup>",
    "",
    "<!-- codesmith:autofix:disabled -->",
    "<!-- /codesmith:footer -->",
  ].join("\n");

  it("ignores the Claude attribution and Blacksmith footer under an empty section", () => {
    expect(releaseNoteLine(`## Release note\n\n<!-- Internal tooling: intentionally empty. -->\n${FOOTER}`)).toBeNull();
  });

  it("reads a note followed by the bot footers", () => {
    expect(releaseNoteLine(`## Release note\nLate applications show how late they were.\n${FOOTER}`)).toBe(
      "Late applications show how late they were.",
    );
  });

  it("takes only the first paragraph", () => {
    expect(releaseNoteLine("## Release note\n\nHold rooms.\n\nSome trailing remark.")).toBe("Hold rooms.");
  });

  it("stops at a horizontal rule", () => {
    expect(releaseNoteLine("## Release note\n---\nHold rooms.")).toBeNull();
  });

  it("stops at the next heading", () => {
    expect(releaseNoteLine("## Release note\nHold rooms.\n## Testing\nRan it.")).toBe("Hold rooms.");
  });

  it("joins lines and strips list markers", () => {
    expect(releaseNoteLine("### Release notes\n- Hold rooms.\n* Cancel holds.")).toBe("Hold rooms. Cancel holds.");
  });

  it("accepts a trailing colon and any heading level", () => {
    expect(releaseNoteLine("# Release Note:\nHold rooms.")).toBe("Hold rooms.");
  });

  it("is null for the repo's untouched PR template", () => {
    const template = readFileSync(new URL("../../../../.github/pull_request_template.md", import.meta.url), "utf8");
    expect(releaseNoteLine(template)).toBeNull();
    expect(releaseNoteLine(`${template}\nHold rooms.`)).toBe("Hold rooms.");
  });

  it.each([
    ["a filled-in template's other sections", TEMPLATE],
    ["a comment-only section", "## Release note\n<!--\nmultiline\n-->\n"],
    ["no heading", "Hold rooms."],
    ["an empty body", ""],
    ["a null body", null],
    ["None", "## Release note\nNone"],
    ["N/A", "## Release note\n- N/A."],
    ["a dash", "## Release note\n-"],
    ["text only in another section", "## Release note\n\n## Summary\nHold rooms."],
  ])("is null for %s", (_, body) => {
    expect(releaseNoteLine(body)).toBeNull();
  });
});

describe("selectPrsToDraft", () => {
  it("dedupes, sorts, and drops unmerged, promotion, cited and PRs without a release note", () => {
    const note = { body: "## Release note\nHold rooms." };
    const prs = [
      pr(5, note),
      pr(3, note),
      pr(5, note),
      pr(4, { ...note, mergedAt: null }),
      pr(6, { ...note, baseRef: "prod" }),
      pr(7, note),
      pr(8, { body: TEMPLATE }),
      pr(9),
    ];
    expect(sel(prs, new Set([7])).map((p) => p.number)).toEqual([3, 5]);
  });

  it("returns nothing for no input", () => {
    expect(sel([])).toEqual([]);
  });
});

describe("chunk", () => {
  it("splits into bounded groups", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 40)).toEqual([]);
    expect(chunk(Array.from({ length: 41 }, (_, i) => i), 40).map((c) => c.length)).toEqual([40, 1]);
  });
});

describe("decideCursor", () => {
  it("records the head on the first run without drafting", () => {
    expect(decideCursor(null, "abc")).toEqual({ action: "record", sha: "abc" });
  });
  it("skips when prod has not moved", () => {
    expect(decideCursor("abc", "abc")).toEqual({ action: "skip" });
  });
  it("drafts the range when prod moved", () => {
    expect(decideCursor("abc", "def")).toEqual({ action: "draft", base: "abc", head: "def" });
  });
});

describe("parseDraftEntries", () => {
  const valid = {
    title: "Faster search",
    summary: "Search finds more.",
    body: "First.\n\nSecond.",
    area: "drive",
    prNumbers: [2, 1, 1],
    uncertain: false,
    uncertainReason: null,
  };
  const input = new Set([1, 2]);

  it("parses a plain array and sorts and dedupes citations", () => {
    const [e] = parseDraftEntries(JSON.stringify([valid]), input)!;
    expect(e.prNumbers).toEqual([1, 2]);
    expect(e.area).toBe("drive");
    expect(e.uncertainReason).toBeNull();
  });

  it("accepts fenced JSON", () => {
    expect(parseDraftEntries("```json\n" + JSON.stringify([valid]) + "\n```", input)).toHaveLength(1);
  });

  it("returns null for bad JSON or a non-array", () => {
    expect(parseDraftEntries("not json", input)).toBeNull();
    expect(parseDraftEntries('{"a":1}', input)).toBeNull();
  });

  it("returns an empty list for an empty array", () => {
    expect(parseDraftEntries("[]", input)).toEqual([]);
  });

  it("drops uncited entries and unknown PR numbers", () => {
    const out = parseDraftEntries(
      JSON.stringify([
        { ...valid, prNumbers: [99] },
        { ...valid, prNumbers: [] },
        { ...valid, prNumbers: [1, 99] },
        { ...valid, prNumbers: "1" },
      ]),
      input,
    )!;
    expect(out).toHaveLength(1);
    expect(out[0].prNumbers).toEqual([1]);
  });

  it("drops entries without a title or summary and non-objects", () => {
    expect(
      parseDraftEntries(JSON.stringify([{ ...valid, title: " " }, { ...valid, summary: 3 }, null, "x"]), input),
    ).toEqual([]);
  });

  it("strips em dashes everywhere", () => {
    const [e] = parseDraftEntries(
      JSON.stringify([{ ...valid, title: "A — B", summary: "C—D", body: "E — F", uncertain: true, uncertainReason: "G — H" }]),
      input,
    )!;
    for (const v of [e.title, e.summary, e.body, e.uncertainReason!]) expect(v).not.toMatch(/—/);
    expect(e.title).toBe("A, B");
  });

  it("coerces unknown or non-string areas to null", () => {
    const out = parseDraftEntries(
      JSON.stringify([{ ...valid, area: "nope" }, { ...valid, area: 4 }, { ...valid, area: null }]),
      input,
    )!;
    expect(out.map((e) => e.area)).toEqual([null, null, null]);
  });

  it("keeps the reason when uncertain and supplies one when missing", () => {
    const out = parseDraftEntries(
      JSON.stringify([
        { ...valid, uncertain: true, uncertainReason: "Maybe internal" },
        { ...valid, uncertain: true },
        { ...valid, uncertain: false, uncertainReason: "ignored" },
      ]),
      input,
    )!;
    expect(out.map((e) => e.uncertainReason)).toEqual(["Maybe internal", "Unclear if this is user-facing", null]);
  });
});

describe("stripEmDashes", () => {
  it("replaces em and en dashes with a comma", () => {
    expect(stripEmDashes("a — b – c")).toBe("a, b, c");
  });
});

describe("buildDraftPrompt", () => {
  it("truncates bodies, caps files, and wraps each PR", () => {
    const text = buildDraftPrompt([
      {
        ...pr(7, { body: "x".repeat(5000), labels: ["ui"] }),
        files: Array.from({ length: 150 }, (_, i) => `f${i}.ts`),
        additions: 3,
        deletions: 1,
      },
    ]);
    expect(text).toContain('<pull_request number="7">');
    expect(text).toContain("labels: ui");
    expect(text).toContain("+3 -1");
    expect(text).toContain("f99.ts");
    expect(text).not.toContain("f100.ts");
    expect(text.match(/x/g)!.length).toBe(3000);
  });

  it("marks empty bodies and missing labels", () => {
    const text = buildDraftPrompt([{ ...pr(1, { body: null }), files: [], additions: 0, deletions: 0 }]);
    expect(text).toContain("labels: none");
    expect(text).toContain("(empty)");
  });
});

describe("DRAFT_SYSTEM_PROMPT", () => {
  it("carries the entry rule and output contract", () => {
    expect(DRAFT_SYSTEM_PROMPT).toContain("not for the people who built it");
    expect(DRAFT_SYSTEM_PROMPT).toContain("widely felt problem");
    expect(DRAFT_SYSTEM_PROMPT).toContain("No em dashes");
    expect(DRAFT_SYSTEM_PROMPT).toContain('"uncertain"');
    expect(DRAFT_SYSTEM_PROMPT).toContain("calendar");
  });
});

describe("bodyToBlocks", () => {
  it("makes one paragraph per blank-line-separated chunk", () => {
    const blocks = bodyToBlocks("One.\n\n  Two.  \n\n\n");
    expect(blocks.map((b) => b.content[0].text)).toEqual(["One.", "Two."]);
    expect(blocks[0].type).toBe("paragraph");
    expect(new Set(blocks.map((b) => b.id)).size).toBe(2);
  });
  it("is empty for an empty body", () => {
    expect(bodyToBlocks("")).toEqual([]);
  });
});

describe("pickCaptureVideoKey", () => {
  const keys = new Map([
    [3, ["release-notes/pr-3/poster.jpg"]],
    [5, ["release-notes/pr-5/b.MP4", "release-notes/pr-5/a.mp4"]],
  ]);
  it("takes the first mp4 from the lowest PR that has one", () => {
    expect(pickCaptureVideoKey(keys, [5, 3])).toBe("release-notes/pr-5/b.MP4");
  });
  it("is null when no cited PR has an mp4", () => {
    expect(pickCaptureVideoKey(keys, [3, 9])).toBeNull();
  });
});
