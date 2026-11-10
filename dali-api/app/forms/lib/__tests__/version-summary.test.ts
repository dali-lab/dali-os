import { describe, expect, it } from "vitest";
import { summarizeResponses, type QuestionSummary } from "~/forms/lib/version-summary";
import type { Question } from "~/types";

const q = (
  key: string,
  type: Question["type"],
  data: Partial<Question["data"]> = {},
): Question => ({ key, type, required: false, data: { label: key.toUpperCase(), ...data } });

const only = (questions: Question[], answers: Record<string, unknown>[], refs?: Map<string, Map<string, string>>) =>
  summarizeResponses(questions, answers, refs).questions[0];

const bars = (s: QuestionSummary) => {
  if (s.kind !== "choice" && s.kind !== "scale") throw new Error("no bars");
  return s.bars;
};

describe("summarizeResponses", () => {
  it("returns nothing for an empty form", () => {
    expect(summarizeResponses([], [{ a: "x" }])).toEqual({ total: 1, questions: [] });
  });

  it("keeps every option with zero counts when there are no responses", () => {
    const s = only([q("a", "select", { options: ["Yes", "No"] })], []);
    expect(bars(s)).toEqual([
      { label: "Yes", count: 0, percent: 0 },
      { label: "No", count: 0, percent: 0 },
    ]);
    expect(s).toMatchObject({ answered: 0, skipped: 0 });
  });

  it("skips layout blocks and numbers real questions in order", () => {
    const out = summarizeResponses(
      [q("i", "info"), q("a", "text"), q("p", "pageBreak"), q("b", "text")],
      [{ a: "hi" }],
    );
    expect(out.questions.map((s) => [s.key, s.number])).toEqual([["a", 1], ["b", 2]]);
  });

  it("counts answered and skipped, treating blanks as skipped", () => {
    const s = only([q("a", "text")], [{ a: "hi" }, { a: "  " }, {}, { a: "yo" }]);
    expect(s).toMatchObject({ kind: "text", answered: 2, skipped: 2 });
  });

  describe("select and radio", () => {
    it.each(["select", "radio"] as const)("counts %s options in form order with percents", (type) => {
      const s = only(
        [q("a", type, { options: ["Red", "Green", "Blue"] })],
        [{ a: "Green" }, { a: "Green" }, { a: "Red" }, {}],
      );
      expect(bars(s)).toEqual([
        { label: "Red", count: 1, percent: 33 },
        { label: "Green", count: 2, percent: 67 },
        { label: "Blue", count: 0, percent: 0 },
      ]);
      expect(s).toMatchObject({ answered: 3, skipped: 1 });
    });

    it("groups answers matching no option into one Other row, last", () => {
      const s = only(
        [q("a", "select", { options: ["Red"] })],
        [{ a: "Red" }, { a: "Purple" }, { a: "Teal" }],
      );
      expect(bars(s)).toEqual([
        { label: "Red", count: 1, percent: 33 },
        { label: "Other", count: 2, percent: 67, other: true },
      ]);
    });

    it("groups radio write-ins into Other", () => {
      const s = only(
        [q("a", "radio", { options: ["Yes", "No"], allowOther: true })],
        [{ a: "Yes" }, { a: "Maybe later" }],
      );
      expect(bars(s).at(-1)).toEqual({ label: "Other", count: 1, percent: 50, other: true });
    });

    it("omits the Other row when nothing falls outside the options", () => {
      const s = only([q("a", "select", { options: ["Red"] })], [{ a: "Red" }]);
      expect(bars(s).some((b) => b.other)).toBe(false);
    });
  });

  describe("checkbox", () => {
    const question = q("a", "checkbox", { options: ["A", "B", "C"] });

    it("lets totals pass 100% because percent is of people who answered", () => {
      const s = only([question], [{ a: ["A", "B"] }, { a: ["A", "B", "C"] }]);
      expect(bars(s)).toEqual([
        { label: "A", count: 2, percent: 100 },
        { label: "B", count: 2, percent: 100 },
        { label: "C", count: 1, percent: 50 },
      ]);
    });

    it("reads a JSON-stringified array as hiring answers store it", () => {
      const s = only([question], [{ a: JSON.stringify(["A", "C"]) }, { a: "[]" }]);
      expect(bars(s).map((b) => b.count)).toEqual([1, 0, 1]);
      expect(s).toMatchObject({ answered: 1, skipped: 1 });
    });

    it("reads a plain string as one selection and survives broken JSON", () => {
      const s = only([question], [{ a: "B" }, { a: "[oops" }]);
      expect(bars(s)).toEqual([
        { label: "A", count: 0, percent: 0 },
        { label: "B", count: 1, percent: 50 },
        { label: "C", count: 0, percent: 0 },
        { label: "Other", count: 1, percent: 50, other: true },
      ]);
    });

    it("counts a person once in Other however many write-ins they have", () => {
      const s = only([question], [{ a: ["A", "x", "y"] }, { a: ["A"] }]);
      expect(bars(s).at(-1)).toEqual({ label: "Other", count: 1, percent: 50, other: true });
    });

    it("counts a repeated value once per person", () => {
      const s = only([question], [{ a: ["A", "A"] }]);
      expect(bars(s)[0].count).toBe(1);
    });
  });

  describe("reference", () => {
    const question = q("r", "reference", { referenceSource: "projects" });
    const refs = new Map([["r", new Map([["p1", "Alpha"], ["p2", "Beta"], ["p3", "Gamma"]])]]);

    it("uses current labels sorted by count and keeps unpicked rows", () => {
      const s = only([question], [{ r: "p2" }, { r: "p2" }, { r: "p1" }], refs);
      expect(bars(s)).toEqual([
        { label: "Beta", count: 2, percent: 67 },
        { label: "Alpha", count: 1, percent: 33 },
        { label: "Gamma", count: 0, percent: 0 },
      ]);
    });

    it("groups a deleted row id into Other", () => {
      const s = only([question], [{ r: "gone" }, { r: "p1" }], refs);
      expect(bars(s).at(-1)).toEqual({ label: "Other", count: 1, percent: 50, other: true });
    });
  });

  describe("skills_rating", () => {
    const question = q("s", "skills_rating", { options: ["React", "Figma"] });

    it("averages rated skills and leaves unrated out", () => {
      const s = only(
        [question],
        [{ s: "React: 5\nFigma: 3" }, { s: "React: 2\nFigma: -" }, { s: "React: 4\nFigma: 0" }],
      );
      expect(s).toMatchObject({ kind: "skills", answered: 3 });
      if (s.kind !== "skills") return;
      expect(s.skills[0]).toEqual({
        skill: "React",
        rated: 3,
        average: 3.7,
        distribution: [0, 0, 1, 0, 1, 1],
      });
      expect(s.skills[1]).toMatchObject({ rated: 2, average: 1.5, distribution: [1, 0, 0, 1, 0, 0] });
    });

    it("handles a partly rated answer and a skill nobody rated", () => {
      const s = only([question], [{ s: "React: 4\nFigma: -" }]);
      if (s.kind !== "skills") throw new Error();
      expect(s.skills[1]).toEqual({ skill: "Figma", rated: 0, average: null, distribution: [0, 0, 0, 0, 0, 0] });
      expect(s.skills[0].average).toBe(4);
    });

    it("counts an all-unrated answer as skipped", () => {
      const s = only([question], [{ s: "React: -\nFigma: -" }, {}]);
      expect(s).toMatchObject({ answered: 0, skipped: 2 });
    });

    it("ignores skills that are no longer on the question", () => {
      const s = only([question], [{ s: "Vue: 5\nReact: 1" }]);
      if (s.kind !== "skills") throw new Error();
      expect(s.skills.map((r) => r.skill)).toEqual(["React", "Figma"]);
    });
  });

  describe("scale", () => {
    it("gives the average and five bars from 1 to 5", () => {
      const s = only([q("n", "scale")], [{ n: "5" }, { n: "4" }, { n: "4" }, { n: "1" }]);
      expect(s).toMatchObject({ kind: "scale", average: 3.5, answered: 4 });
      expect(bars(s)).toEqual([
        { label: "1", count: 1, percent: 25 },
        { label: "2", count: 0, percent: 0 },
        { label: "3", count: 0, percent: 0 },
        { label: "4", count: 2, percent: 50 },
        { label: "5", count: 1, percent: 25 },
      ]);
    });

    it("has no average with no answers and ignores out-of-range values", () => {
      const s = only([q("n", "scale")], [{ n: "9" }, {}]);
      expect(s).toMatchObject({ average: null });
      expect(bars(s).every((b) => b.count === 0)).toBe(true);
    });
  });

  describe("number", () => {
    it("gives count, average, lowest and highest", () => {
      const s = only([q("n", "number")], [{ n: "10" }, { n: "-2" }, { n: "4.5" }]);
      expect(s).toMatchObject({ kind: "number", count: 3, average: 4.17, lowest: -2, highest: 10 });
    });

    it("ignores non-numeric values but still counts them as answered", () => {
      const s = only([q("n", "number")], [{ n: "8" }, { n: "lots" }, { n: "1e3" }, {}]);
      expect(s).toMatchObject({ count: 1, average: 8, lowest: 8, highest: 8, answered: 3, skipped: 1 });
    });

    it("has empty stats with no numeric values", () => {
      const s = only([q("n", "number")], [{ n: "x" }]);
      expect(s).toMatchObject({ count: 0, average: null, lowest: null, highest: null });
    });
  });

  it.each(["text", "textarea", "email", "date", "github_url", "figma_url", "drive_url", "file"] as const)(
    "shows only an answered count for %s",
    (type) => {
      const s = only([q("a", type)], [{ a: "x" }, {}]);
      expect(s).toMatchObject({ kind: "text", answered: 1, skipped: 1 });
    },
  );
});


describe("summarizeResponses with rules", () => {
  const source = q("domains", "checkbox", { options: ["Design", "Eng"] });
  const follow = (extra: Partial<Question["data"]> = {}) =>
    q("portfolio", "text", { showIf: { questionKey: "domains", op: "includes", value: "Design" }, ...extra });
  const rows = [
    { domains: ["Design"], portfolio: "a.com" },
    { domains: JSON.stringify(["Design", "Eng"]) },
    { domains: ["Eng"] },
    { domains: ["Eng"], portfolio: "stale" },
    {},
  ];
  const summaryOf = (questions: Question[], answers: Record<string, unknown>[], index = 1) =>
    summarizeResponses(questions, answers).questions[index];

  it("counts only the people who were asked, and says who they were", () => {
    const s = summaryOf([source, follow()], rows);
    expect(s).toMatchObject({
      answered: 1,
      skipped: 1,
      asked: { count: 2, who: "who picked Design in Q1" },
    });
  });

  it("does not count people who were not asked as skipped", () => {
    const s = summaryOf([source, follow()], [{ domains: ["Eng"] }, { domains: ["Eng"] }]);
    expect(s).toMatchObject({ answered: 0, skipped: 0, asked: { count: 0 } });
  });

  it("ignores a stored answer from someone who was not asked", () => {
    const s = summaryOf([source, follow({ options: undefined })], rows);
    expect(s.answered).toBe(1);
  });

  it("takes percents from the people asked", () => {
    const choice = q("pick", "select", {
      options: ["X", "Y"],
      showIf: { questionKey: "domains", op: "includes", value: "Design" },
    });
    const s = summaryOf(
      [source, choice],
      [
        { domains: ["Design"], pick: "X" },
        { domains: ["Design"], pick: "X" },
        { domains: ["Design"], pick: "Y" },
        { domains: ["Eng"] },
      ],
    );
    expect(bars(s)).toEqual([
      { label: "X", count: 2, percent: 67 },
      { label: "Y", count: 1, percent: 33 },
    ]);
    expect(s).toMatchObject({ answered: 3, skipped: 0, asked: { count: 3 } });
  });

  it("follows a chain, and a hidden source counts as not asking", () => {
    const gate = q("gate", "select", { options: ["Yes", "No"] });
    const mid = q("mid", "select", {
      options: ["A", "B"],
      showIf: { questionKey: "gate", op: "is", value: "Yes" },
    });
    const last = q("last", "text", { showIf: { questionKey: "mid", op: "is", value: "A" } });
    const s = summaryOf(
      [gate, mid, last],
      [
        { gate: "Yes", mid: "A", last: "x" },
        { gate: "Yes", mid: "B" },
        { gate: "No", mid: "A", last: "stale" },
      ],
      2,
    );
    expect(s).toMatchObject({ answered: 1, skipped: 0, asked: { count: 1, who: "who picked A in Q2" } });
  });

  it("says nothing about who was asked for an unconditional question", () => {
    const s = summaryOf([source, q("plain", "text")], rows);
    expect(s).not.toHaveProperty("asked");
    expect(s).toMatchObject({ answered: 0, skipped: 5 });
  });

  it("writes the negative audiences", () => {
    const s = summaryOf(
      [source, q("p", "text", { showIf: { questionKey: "domains", op: "excludes", value: "Design" } })],
      [{ domains: ["Eng"] }],
    );
    expect(s.asked?.who).toBe("who didn't pick Design in Q1");
  });
});
