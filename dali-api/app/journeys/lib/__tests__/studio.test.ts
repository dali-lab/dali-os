import { describe, expect, it } from "vitest";
import {
  createCanvasItem,
  createCriterion,
  createStudio,
  describeRule,
  evaluateCriteria,
  evaluateRule,
  foundHotspots,
  initialWork,
  needsMentor,
  PIN_RADIUS,
  readyForReview,
  RULE_KINDS_FOR,
  studioIssues,
} from "../studio";
import type { CanvasItem, StudioLab } from "../studio-types";

const text = (t: string) => [{ type: "text", text: t, styles: {} }];
const h = (t: string) => ({ type: "heading", props: { level: 3 }, content: text(t), children: [] });
const p = (t: string) => ({ type: "paragraph", content: text(t), children: [] });
const li = (t: string, children: object[] = []) => ({ type: "bulletListItem", content: text(t), children });

const board: StudioLab = {
  kind: "canvas",
  title: "Critique",
  brief: "",
  criteria: [],
  canvas: {
    items: [{ id: "starter", type: "sticky", x: 0, y: 0, color: "yellow", text: "how to", locked: true }],
    hotspots: [
      { id: "h1", label: "A", x: 0, y: 0, width: 100, height: 100 },
      { id: "h2", label: "B", x: 200, y: 0, width: 100, height: 100 },
    ],
  },
};
const doc: StudioLab = { kind: "document", title: "Ticket", brief: "", criteria: [], document: { template: [] } };
const pinAt = (id: string, cx: number, cy: number): CanvasItem => ({ id, type: "pin", x: cx - PIN_RADIUS, y: cy - PIN_RADIUS, text: "" });

describe("starting work", () => {
  it("copies the starter board marked as starter items", () => {
    expect(initialWork(board).items).toEqual([{ ...board.canvas!.items[0], fromStarter: true }]);
  });

  it("starts a document from its template", () => {
    const tpl = [h("Why")];
    expect(initialWork({ ...doc, document: { template: tpl as never } }).doc).toEqual(tpl);
  });

  it("creates labs and criteria with a check that fits the kind", () => {
    expect(createStudio("canvas").canvas).toEqual({ items: [], hotspots: [] });
    expect(createStudio("document").document?.template.length).toBeGreaterThan(0);
    expect(createCriterion("auto", "document").rule?.kind).toBe(RULE_KINDS_FOR.document[0].kind);
    expect(createCriterion("self", "canvas").rule).toBeUndefined();
  });

  it("centres new items on the click", () => {
    const sticky = createCanvasItem("sticky", 100, 100);
    expect(sticky.x + sticky.width! / 2).toBe(100);
    const pin = createCanvasItem("pin", 50, 50);
    expect(pin.x + PIN_RADIUS).toBe(50);
  });
});

describe("whiteboard checks", () => {
  it("counts only the learner's own items, by type and colour", () => {
    const rule = { kind: "item-count", itemType: "sticky", color: "pink", min: 2 } as const;
    const items: CanvasItem[] = [
      { id: "starter", type: "sticky", x: 0, y: 0, color: "pink", fromStarter: true },
      { id: "a", type: "sticky", x: 0, y: 0, color: "pink" },
      { id: "b", type: "sticky", x: 0, y: 0, color: "yellow" },
      { id: "c", type: "text", x: 0, y: 0 },
    ];
    expect(evaluateRule(rule, board, { items })).toEqual({ passed: false, detail: "1 of 2" });
    expect(evaluateRule({ kind: "item-count", itemType: "any", min: 3 }, board, { items })).toEqual({ passed: true, detail: "3 of 3" });
  });

  it("finds a hotspot when the pin's point lands inside it", () => {
    const work = { items: [pinAt("p1", 50, 50), pinAt("p2", 150, 50)] };
    expect([...foundHotspots(board, work)]).toEqual(["h1"]);
    expect(evaluateRule({ kind: "hotspots", min: 2 }, board, work)).toEqual({ passed: false, detail: "1 of 2 found" });
  });

  it("ignores starter pins when finding hotspots", () => {
    expect(foundHotspots(board, { items: [{ ...pinAt("p", 50, 50), fromStarter: true }] }).size).toBe(0);
  });

  it("searches sticky text for a phrase, ignoring case, and never passes an empty phrase", () => {
    const work = { items: [{ id: "a", type: "sticky" as const, x: 0, y: 0, text: "Raise the CONTRAST" }] };
    expect(evaluateRule({ kind: "contains-text", text: "contrast" }, board, work).passed).toBe(true);
    expect(evaluateRule({ kind: "contains-text", text: "  " }, board, work).passed).toBe(false);
  });
});

describe("document checks", () => {
  const work = {
    doc: [
      h("Title"),
      p("Show availability"),
      h("Why"),
      p("Students walk across campus for nothing."),
      h("Done when"),
      li("Shows Available or In use", [li("Updates within a minute")]),
      li(""),
      { type: "numberedListItem", content: text("Filter to available"), children: [] },
      h("Out of scope"),
    ] as never,
  };

  it("counts words in a section up to the next heading, matching the heading loosely", () => {
    expect(evaluateRule({ kind: "section", heading: "why", minWords: 6 }, doc, work)).toEqual({ passed: true, detail: "6 of 6 words" });
    expect(evaluateRule({ kind: "section", heading: "Out of scope", minWords: 1 }, doc, work)).toEqual({ passed: false, detail: "0 of 1 words" });
  });

  it("reports a missing section", () => {
    expect(evaluateRule({ kind: "section", heading: "Design", minWords: 1 }, doc, work)).toEqual({ passed: false, detail: "Section missing" });
    expect(evaluateRule({ kind: "section", heading: "", minWords: 1 }, doc, work).passed).toBe(false);
  });

  it("counts non-empty list items in a section, nested ones included", () => {
    expect(evaluateRule({ kind: "list-items", heading: "Done when", min: 3 }, doc, work)).toEqual({ passed: true, detail: "3 of 3 items" });
  });

  it("counts every word in the document, links included", () => {
    const linked = { doc: [{ type: "paragraph", content: [{ type: "link", href: "x", content: text("two words") }], children: [] }] as never };
    expect(evaluateRule({ kind: "word-count", min: 2 }, doc, linked)).toEqual({ passed: true, detail: "2 of 2 words" });
  });
});

describe("criteria", () => {
  const lab: StudioLab = {
    ...board,
    criteria: [
      { id: "a", label: "Pins", mode: "auto", rule: { kind: "hotspots", min: 1 } },
      { id: "s", label: "Self", mode: "self" },
      { id: "m", label: "Mentor", mode: "mentor" },
      { id: "broken", label: "No rule", mode: "auto" },
    ],
  };
  const work = { items: [pinAt("p", 50, 50)] };
  const states = (status: Parameters<typeof evaluateCriteria>[4], mentor = {}) =>
    evaluateCriteria(lab, work, { s: true }, mentor, status).map((r) => r.state);

  it("leaves mentor items pending until a review", () => {
    expect(states("in-progress")).toEqual(["pass", "pass", "pending", "fail"]);
    expect(states("submitted")[2]).toBe("pending");
  });

  it("passes mentor items on approval and uses the mentor's ticks when changes are requested", () => {
    expect(states("approved")[2]).toBe("pass");
    expect(states("changes-requested", { m: false })[2]).toBe("fail");
    expect(states("changes-requested", { m: true })[2]).toBe("pass");
  });

  it("is ready for review once every automatic and self check passes", () => {
    const ok = evaluateCriteria({ ...lab, criteria: lab.criteria.slice(0, 3) }, work, { s: true }, {}, "in-progress");
    expect(readyForReview(ok)).toBe(true);
    expect(readyForReview(evaluateCriteria(lab, work, {}, {}, "in-progress"))).toBe(false);
  });

  it("knows when a lab needs a mentor", () => {
    expect(needsMentor(lab)).toBe(true);
    expect(needsMentor({ ...lab, criteria: lab.criteria.slice(0, 2) })).toBe(false);
  });
});

describe("authoring", () => {
  it("describes every rule kind", () => {
    expect(describeRule({ kind: "item-count", itemType: "sticky", color: "pink", min: 2 })).toBe("At least 2 pink sticky notes added by the learner");
    expect(describeRule({ kind: "contains-text", text: "" })).toBe("Mentions a phrase");
    expect(describeRule({ kind: "section", heading: "Why", minWords: 15 })).toBe('"Why" section has at least 15 words');
    expect(describeRule({ kind: "list-items", heading: "", min: 2 })).toBe('"..." section lists at least 2 items');
    expect(describeRule({ kind: "hotspots", min: 4 })).toContain("at least 4");
    expect(describeRule({ kind: "word-count", min: 100 })).toBe("At least 100 words in total");
  });

  it("lists what blocks publishing", () => {
    expect(studioIssues({ ...board, title: "", criteria: [] })).toEqual(["the lab needs a title.", "the lab needs at least one criterion."]);
    expect(
      studioIssues({
        ...board,
        criteria: [
          { id: "1", label: "", mode: "self" },
          { id: "2", label: "x", mode: "auto" },
          { id: "3", label: "x", mode: "auto", rule: { kind: "section", heading: " ", minWords: 1 } },
          { id: "4", label: "x", mode: "auto", rule: { kind: "contains-text", text: "" } },
          { id: "5", label: "x", mode: "auto", rule: { kind: "hotspots", min: 3 } },
        ],
      }),
    ).toEqual([
      "lab criterion 1 has no text.",
      "lab criterion 2 has no automatic check set up.",
      "lab criterion 3 needs a heading to look for.",
      "lab criterion 4 needs a phrase to look for.",
      "lab criterion 5 asks for more problem areas than the board has.",
    ]);
  });
});
