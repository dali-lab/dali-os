import { describe, expect, it } from "vitest";
import {
  filterSummary,
  filterableQuestions,
  parseAnswerFilters,
  serializeAnswerFilters,
  validateAnswerFilterInputs,
  withAnswerFilters,
} from "~/forms/lib/answer-filters";
import type { Question } from "~/types";

const q = (key: string, type: Question["type"], data: Partial<Question["data"]> = {}): Question => ({
  key,
  type,
  required: false,
  data: { label: `${key} label`, ...data },
});

const questions: Question[] = [
  q("pick", "select", { options: ["Red", "Blue"] }),
  q("fav", "radio", { options: ["Cat", "Dog"], allowOther: true }),
  q("tags", "checkbox", { options: ["A", "B"], allowOther: true }),
  q("rate", "scale", { scaleLow: "Poor", scaleHigh: "Great" }),
  q("proj", "reference", { referenceSource: "projects" }),
  q("bio", "textarea"),
  q("age", "number"),
  q("when", "date"),
  q("resume", "file"),
  q("skills", "skills_rating", { options: ["x"] }),
  q("intro", "info"),
  q("br", "pageBreak"),
];

describe("parseAnswerFilters", () => {
  it("reads each op into its kind", () => {
    expect(
      parseAnswerFilters(
        ["pick:is:Red", "bio:has:hello", "age:min:3", "when:answered", "tags:blank"],
        questions,
      ),
    ).toEqual([
      { key: "pick", kind: "is", values: ["Red"] },
      { key: "bio", kind: "contains", text: "hello" },
      { key: "age", kind: "range", min: "3" },
      { key: "when", kind: "answered" },
      { key: "tags", kind: "blank" },
    ]);
  });

  it("reads params off a URLSearchParams", () => {
    const params = new URLSearchParams("view=results&a=pick:is:Red&a=pick:is:Blue");
    expect(parseAnswerFilters(params, questions)).toEqual([
      { key: "pick", kind: "is", values: ["Red", "Blue"] },
    ]);
  });

  it("drops unknown keys, unfilterable types, unknown ops and empty values", () => {
    expect(
      parseAnswerFilters(
        [
          "nope:is:x",
          "resume:answered",
          "skills:is:x",
          "intro:blank",
          "br:answered",
          "pick:wat:x",
          "pick:is:",
          "pick:is",
          "bio:has:   ",
          "no-colon",
          "",
        ],
        questions,
      ),
    ).toEqual([]);
  });

  it("drops a kind the question type doesn't take", () => {
    expect(parseAnswerFilters(["bio:is:x", "pick:has:x", "pick:min:3", "age:has:x", "age:is:3"], questions)).toEqual([]);
  });

  it("drops range bounds that aren't numbers or dates", () => {
    expect(parseAnswerFilters(["age:min:abc", "age:max:1e5", "when:min:2026-1-1", "when:max:soon"], questions)).toEqual([]);
    expect(parseAnswerFilters(["age:min:-2.5", "when:max:2026-05-01"], questions)).toEqual([
      { key: "age", kind: "range", min: "-2.5" },
      { key: "when", kind: "range", max: "2026-05-01" },
    ]);
  });

  it("splits on the first two colons only", () => {
    expect(parseAnswerFilters(["bio:has:a:b:c", "pick:is:Re:d"], questions)).toEqual([
      { key: "bio", kind: "contains", text: "a:b:c" },
      { key: "pick", kind: "is", values: ["Re:d"] },
    ]);
  });

  it("merges repeated is values without duplicates and min with max", () => {
    expect(
      parseAnswerFilters(["pick:is:Red", "pick:is:Blue", "pick:is:Red", "age:min:1", "age:max:9"], questions),
    ).toEqual([
      { key: "pick", kind: "is", values: ["Red", "Blue"] },
      { key: "age", kind: "range", min: "1", max: "9" },
    ]);
  });

  it("keeps the first kind a question was given", () => {
    expect(parseAnswerFilters(["pick:blank", "pick:is:Red", "pick:answered"], questions)).toEqual([
      { key: "pick", kind: "blank" },
    ]);
    expect(parseAnswerFilters(["bio:has:one", "bio:has:two", "bio:blank"], questions)).toEqual([
      { key: "bio", kind: "contains", text: "one" },
    ]);
  });

  it("accepts the Other sentinel", () => {
    expect(parseAnswerFilters(["fav:is:__other__"], questions)).toEqual([
      { key: "fav", kind: "is", values: ["__other__"] },
    ]);
  });
});

describe("serializeAnswerFilters", () => {
  it("round-trips every kind", () => {
    const entries = [
      "pick:is:Red",
      "pick:is:Blue",
      "bio:has:a:b",
      "age:min:1",
      "age:max:9",
      "when:answered",
      "tags:blank",
    ];
    const filters = parseAnswerFilters(entries, questions);
    expect(serializeAnswerFilters(filters)).toEqual([
      "pick:is:Red",
      "pick:is:Blue",
      "bio:has:a:b",
      "age:min:1",
      "age:max:9",
      "when:answered",
      "tags:blank",
    ]);
    expect(parseAnswerFilters(serializeAnswerFilters(filters), questions)).toEqual(filters);
  });
});

describe("withAnswerFilters", () => {
  it("replaces the a params and goes back to page one, keeping the rest", () => {
    const params = new URLSearchParams("view=results&version=2&page=4&a=pick:is:Red&q=ada");
    const next = withAnswerFilters(params, [{ key: "age", kind: "range", min: "3" }]);
    expect(next.getAll("a")).toEqual(["age:min:3"]);
    expect(next.get("page")).toBeNull();
    expect(next.get("q")).toBe("ada");
    expect(next.get("view")).toBe("results");
  });

  it("skips filters with nothing in them", () => {
    const next = withAnswerFilters(new URLSearchParams(), [
      { key: "pick", kind: "is", values: [] },
      { key: "bio", kind: "contains", text: " " },
    ]);
    expect(next.has("a")).toBe(false);
  });
});

describe("filterableQuestions", () => {
  const refs = new Map([["proj", new Map([["p2", "Zeta"], ["p1", "Alpha"]])]]);
  const out = filterableQuestions(questions, refs);

  it("leaves out file, skills rating and layout questions", () => {
    expect(out.map((o) => o.key)).toEqual(["pick", "fav", "tags", "rate", "proj", "bio", "age", "when"]);
  });

  it("gives each question its primary kind", () => {
    expect(Object.fromEntries(out.map((o) => [o.key, o.primary]))).toMatchObject({
      pick: "is",
      rate: "is",
      proj: "is",
      bio: "contains",
      age: "range",
      when: "range",
    });
  });

  it("adds Other only where allowOther is set", () => {
    expect(out.find((o) => o.key === "fav")!.options!.at(-1)).toEqual({ value: "__other__", label: "Other" });
    expect(out.find((o) => o.key === "tags")!.options!.at(-1)).toEqual({ value: "__other__", label: "Other" });
    expect(out.find((o) => o.key === "pick")!.options).toEqual([
      { value: "Red", label: "Red" },
      { value: "Blue", label: "Blue" },
    ]);
  });

  it("labels the ends of a scale and sorts reference labels", () => {
    expect(out.find((o) => o.key === "rate")!.options!.map((o) => o.label)).toEqual([
      "1 (Poor)",
      "2",
      "3",
      "4",
      "5 (Great)",
    ]);
    expect(out.find((o) => o.key === "proj")!.options).toEqual([
      { value: "p1", label: "Alpha" },
      { value: "p2", label: "Zeta" },
    ]);
  });
});

describe("filterSummary", () => {
  const by = Object.fromEntries(filterableQuestions(questions, new Map([["proj", new Map([["p1", "Alpha"]])]])).map((o) => [o.key, o]));

  it("names options by label and abbreviates past two", () => {
    expect(filterSummary({ key: "proj", kind: "is", values: ["p1", "gone"] }, by.proj)).toBe("Alpha, gone");
    expect(filterSummary({ key: "fav", kind: "is", values: ["__other__"] }, by.fav)).toBe("Other");
    expect(filterSummary({ key: "proj", kind: "is", values: ["p1", "a", "b"] }, by.proj)).toBe("Alpha +2");
  });

  it("reads each other kind in plain words", () => {
    expect(filterSummary({ key: "bio", kind: "contains", text: "hi" }, by.bio)).toBe('"hi"');
    expect(filterSummary({ key: "age", kind: "range", min: "1", max: "5" }, by.age)).toBe("1 to 5");
    expect(filterSummary({ key: "age", kind: "range", min: "1" }, by.age)).toBe("1 or more");
    expect(filterSummary({ key: "age", kind: "range", max: "5" }, by.age)).toBe("5 or less");
    expect(filterSummary({ key: "age", kind: "answered" }, by.age)).toBe("Answered");
    expect(filterSummary({ key: "age", kind: "blank" }, by.age)).toBe("No answer");
  });
});

describe("filterableQuestions numbering", () => {
  it("carries each question's display number", () => {
    const out = filterableQuestions(questions);
    expect(out.every((o) => typeof o.number === "number")).toBe(true);
  });
});

describe("validateAnswerFilterInputs", () => {
  const run = (inputs: object[]) => validateAnswerFilterInputs(inputs, questions);

  it("accepts a valid filter of each kind", () => {
    expect(
      run([
        { questionKey: "pick", kind: "is", values: ["Red", "Red"] },
        { questionKey: "fav", kind: "is", values: ["__other__"] },
        { questionKey: "bio", kind: "contains", text: " hi " },
        { questionKey: "age", kind: "range", min: 3, max: "9.5" },
        { questionKey: "when", kind: "blank" },
      ]),
    ).toEqual({
      errors: [],
      filters: [
        { key: "pick", kind: "is", values: ["Red"] },
        { key: "fav", kind: "is", values: ["__other__"] },
        { key: "bio", kind: "contains", text: "hi" },
        { key: "age", kind: "range", min: "3", max: "9.5" },
        { key: "when", kind: "blank" },
      ],
    });
  });

  it("names every problem instead of dropping it", () => {
    const { filters, errors } = run([
      { questionKey: "nope", kind: "is", values: ["x"] },
      { questionKey: "resume", kind: "answered" },
      { questionKey: "bio", kind: "is", values: ["x"] },
      { questionKey: "pick", kind: "weird" },
      { questionKey: "pick", kind: "is", values: [] },
      { questionKey: "pick", kind: "is", values: ["Green"] },
      { questionKey: "pick", kind: "answered" },
      { questionKey: "bio", kind: "contains", text: "  " },
      { questionKey: "age", kind: "range" },
      { questionKey: "age", kind: "range", min: "abc" },
      { questionKey: "when", kind: "range", max: "May 1" },
      { questionKey: "tags", kind: "is", values: ["__other__"] },
      { questionKey: "pick", kind: "answered" },
    ]);
    expect(filters.map((f) => f.key)).toEqual(["pick", "tags"]);
    expect(errors).toHaveLength(11);
    expect(errors[0]).toContain('"nope" is not a question');
    expect(errors[1]).toContain("file questions can't be filtered");
    expect(errors[2]).toContain("supports kind contains, answered, blank, not is");
    expect(errors[5]).toContain('"Green" is not an option');
    expect(errors[5]).toContain("Red, Blue");
    expect(errors[10]).toContain("appears twice");
  });

  it("refuses the Other sentinel where Other isn't offered", () => {
    expect(run([{ questionKey: "pick", kind: "is", values: ["__other__"] }]).errors).toHaveLength(1);
  });
});
