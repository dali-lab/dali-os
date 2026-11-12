import { describe, it, expect } from "vitest";
import {
  OTHER_VALUE,
  canBeSource,
  conditionalKeys,
  defaultCondition,
  ruleOf,
  shownWhenSentence,
  toShowIf,
  valueInput,
  hiddenQuestionKeys,
  opsForSource,
  pruneHiddenAnswers,
  questionNumbers,
  ruleDepths,
  showIfProblems,
  showIfSentence,
  valuesForSource,
  visibleKeys,
  visiblePages,
  visibleQuestions,
  type ShowIfOp,
} from "../form-logic";
import type { Question } from "~/types";

function q(
  key: string,
  type: Question["type"] = "text",
  data: Partial<Question["data"]> = {},
): Question {
  return { key, type, required: false, data: { label: key, ...data } };
}
const yesNo = (key = "a") => q(key, "select", { options: ["Yes", "No"] });
const rule = (questionKey: string, op: ShowIfOp, value: string) => ({
  showIf: { questionKey, op, value },
});
const keys = (list: Question[]) => list.map((x) => x.key);
const brk = (key: string) => q(key, "pageBreak");

describe("visibleQuestions: select, radio and scale sources", () => {
  const sources: [Question["type"], Partial<Question["data"]>, string, string][] = [
    ["select", { options: ["Yes", "No"] }, "Yes", "No"],
    ["radio", { options: ["Yes", "No"] }, "Yes", "No"],
    ["scale", {}, "4", "2"],
  ];

  for (const [type, data, match, other] of sources) {
    describe(type, () => {
      const form = (op: ShowIfOp) => [q("a", type, data), q("b", "text", rule("a", op, match))];

      it("is shows only on a match", () => {
        expect(keys(visibleQuestions(form("is"), { a: match }))).toEqual(["a", "b"]);
        expect(keys(visibleQuestions(form("is"), { a: other }))).toEqual(["a"]);
      });

      it("isNot shows only on an answered non-match", () => {
        expect(keys(visibleQuestions(form("isNot"), { a: other }))).toEqual(["a", "b"]);
        expect(keys(visibleQuestions(form("isNot"), { a: match }))).toEqual(["a"]);
      });

      it("hides for both operators while the source is unanswered", () => {
        for (const op of ["is", "isNot"] as const) {
          for (const answers of [{}, { a: "" }, { a: "  " }, { a: undefined }, { a: null }]) {
            expect(keys(visibleQuestions(form(op), answers))).toEqual(["a"]);
          }
        }
      });
    });
  }

  it("treats an Other write-in on a radio as never matching is, and matching isNot", () => {
    const radio = q("a", "radio", { options: ["Yes", "No"], allowOther: true });
    const is = [radio, q("b", "text", rule("a", "is", "Yes"))];
    const isNot = [radio, q("b", "text", rule("a", "isNot", "Yes"))];
    expect(keys(visibleQuestions(is, { a: "Maybe" }))).toEqual(["a"]);
    expect(keys(visibleQuestions(isNot, { a: "Maybe" }))).toEqual(["a", "b"]);
  });

  it("matches numbers stored as numbers", () => {
    const form = [q("a", "scale"), q("b", "text", rule("a", "is", "3"))];
    expect(keys(visibleQuestions(form, { a: 3 }))).toEqual(["a", "b"]);
  });
});

describe("visibleQuestions: checkbox sources", () => {
  const box = q("a", "checkbox", { options: ["Design", "Eng", "PM"] });
  const form = (op: ShowIfOp) => [box, q("b", "text", rule("a", op, "Design"))];

  for (const [shape, encode] of [
    ["string[]", (v: string[]) => v],
    ["JSON string", (v: string[]) => JSON.stringify(v)],
  ] as const) {
    describe(shape, () => {
      it("includes shows when the value is among the picks", () => {
        expect(keys(visibleQuestions(form("includes"), { a: encode(["Eng", "Design"]) }))).toEqual([
          "a",
          "b",
        ]);
        expect(keys(visibleQuestions(form("includes"), { a: encode(["Eng"]) }))).toEqual(["a"]);
      });

      it("excludes shows when something else is picked but not the value", () => {
        expect(keys(visibleQuestions(form("excludes"), { a: encode(["Eng"]) }))).toEqual(["a", "b"]);
        expect(keys(visibleQuestions(form("excludes"), { a: encode(["Design", "Eng"]) }))).toEqual([
          "a",
        ]);
      });

      it("hides for both operators when nothing is picked", () => {
        for (const op of ["includes", "excludes"] as const) {
          expect(keys(visibleQuestions(form(op), { a: encode([]) }))).toEqual(["a"]);
        }
      });
    });
  }

  it("hides for both operators when unanswered or unreadable", () => {
    for (const op of ["includes", "excludes"] as const) {
      for (const answers of [{}, { a: "" }, { a: "not json" }, { a: "{}" }, { a: 5 }, { a: [""] }]) {
        expect(keys(visibleQuestions(form(op), answers))).toEqual(["a"]);
      }
    }
  });

  it("counts an Other write-in as a value that is not the rule's value", () => {
    expect(keys(visibleQuestions(form("excludes"), { a: ["Something else"] }))).toEqual(["a", "b"]);
    expect(keys(visibleQuestions(form("includes"), { a: ["Something else"] }))).toEqual(["a"]);
  });
});

describe("visibleQuestions: order, chains and layout", () => {
  it("returns the same array when no question has a rule", () => {
    const form = [q("a"), q("b"), brk("p"), q("c")];
    expect(visibleQuestions(form, { a: "x" })).toBe(form);
  });

  it("hides a question whose source comes later", () => {
    const form = [q("b", "text", rule("a", "is", "Yes")), yesNo("a")];
    expect(keys(visibleQuestions(form, { a: "Yes" }))).toEqual(["a"]);
  });

  it("hides a question whose source was deleted", () => {
    const form = [yesNo("a"), q("b", "text", rule("gone", "is", "Yes"))];
    expect(keys(visibleQuestions(form, { a: "Yes", gone: "Yes" }))).toEqual(["a"]);
  });

  it("hides a question that points at itself", () => {
    const form = [q("a", "select", { options: ["Yes"], ...rule("a", "is", "Yes") })];
    expect(visibleQuestions(form, { a: "Yes" })).toEqual([]);
  });

  it("chains: hiding the middle question hides the last", () => {
    const form = [
      yesNo("a"),
      q("b", "select", { options: ["X", "Y"], ...rule("a", "is", "Yes") }),
      q("c", "text", rule("b", "is", "X")),
    ];
    expect(keys(visibleQuestions(form, { a: "Yes", b: "X" }))).toEqual(["a", "b", "c"]);
    expect(keys(visibleQuestions(form, { a: "No", b: "X" }))).toEqual(["a"]);
    expect(keys(visibleQuestions(form, { a: "Yes" }))).toEqual(["a", "b"]);
  });

  it("chains: a hidden source counts as unanswered even for isNot and excludes", () => {
    const form = [
      yesNo("a"),
      q("b", "checkbox", { options: ["X", "Y"], ...rule("a", "is", "Yes") }),
      q("c", "text", rule("b", "excludes", "X")),
      q("d", "text", rule("b", "includes", "X")),
    ];
    expect(keys(visibleQuestions(form, { a: "No", b: ["Y"] }))).toEqual(["a"]);
    expect(keys(visibleQuestions(form, { a: "Yes", b: ["Y"] }))).toEqual(["a", "b", "c"]);
  });

  it("lets an info block be conditional", () => {
    const form = [yesNo("a"), q("note", "info", rule("a", "is", "No"))];
    expect(keys(visibleQuestions(form, { a: "No" }))).toEqual(["a", "note"]);
    expect(keys(visibleQuestions(form, { a: "Yes" }))).toEqual(["a"]);
  });


  it("evaluates against the answers it is given, so a changed answer restores the question", () => {
    const form = [yesNo("a"), q("b", "text", rule("a", "is", "Yes"))];
    expect(keys(visibleQuestions(form, { a: "No", b: "typed" }))).toEqual(["a"]);
    expect(keys(visibleQuestions(form, { a: "Yes", b: "typed" }))).toEqual(["a", "b"]);
  });
});

describe("visiblePages", () => {
  it("matches paginateQuestions exactly when no question has a rule", () => {
    const form = [q("a"), brk("p1"), brk("p2"), q("b"), brk("p3")];
    const pages = visiblePages(form, {});
    expect(pages.map((p) => keys(p.questions))).toEqual([["a"], [], ["b"], []]);
  });

  it("drops a page that rules emptied and keeps its neighbours", () => {
    const form = [
      yesNo("a"),
      brk("p1"),
      q("b", "text", rule("a", "is", "Yes")),
      brk("p2"),
      q("c"),
    ];
    expect(visiblePages(form, { a: "No" }).map((p) => keys(p.questions))).toEqual([["a"], ["c"]]);
    expect(visiblePages(form, { a: "Yes" }).map((p) => keys(p.questions))).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
  });

  it("keeps a page that was empty before rules ran", () => {
    const form = [yesNo("a"), brk("p1"), brk("p2"), q("b", "text", rule("a", "is", "Yes"))];
    expect(visiblePages(form, { a: "No" }).map((p) => keys(p.questions))).toEqual([["a"], []]);
  });

  it("keeps the heading of a page that still has questions", () => {
    const form = [
      yesNo("a"),
      { ...brk("p1"), data: { label: "More", description: "Sub" } },
      q("b", "text", rule("a", "is", "Yes")),
      q("c"),
    ];
    const pages = visiblePages(form, { a: "No" });
    expect(pages[1].title).toBe("More");
    expect(keys(pages[1].questions)).toEqual(["c"]);
  });

  it("falls back to one empty page when every page was emptied", () => {
    const form = [q("a", "text", rule("gone", "is", "x"))];
    expect(visiblePages(form, {}).map((p) => keys(p.questions))).toEqual([[]]);
  });

  it("lets a rule point across a page break", () => {
    const form = [yesNo("a"), brk("p"), q("b", "text", rule("a", "is", "Yes"))];
    expect(visiblePages(form, { a: "Yes" }).map((p) => keys(p.questions))).toEqual([["a"], ["b"]]);
  });
});

describe("pruneHiddenAnswers", () => {
  const form = [yesNo("a"), q("b", "text", rule("a", "is", "Yes")), q("c")];

  it("removes answers to hidden questions and keeps the rest", () => {
    expect(pruneHiddenAnswers(form, { a: "No", b: "typed", c: "kept", extra: "x" })).toEqual({
      a: "No",
      c: "kept",
      extra: "x",
    });
  });

  it("returns the answers untouched when nothing is hidden", () => {
    const answers = { a: "Yes", b: "typed" };
    expect(pruneHiddenAnswers(form, answers)).toBe(answers);
  });

  it("does not mutate its input", () => {
    const answers = { a: "No", b: "typed" };
    pruneHiddenAnswers(form, answers);
    expect(answers).toEqual({ a: "No", b: "typed" });
  });

  it("removes a whole chain", () => {
    const chain = [yesNo("a"), q("b", "select", { options: ["X"], ...rule("a", "is", "Yes") }), q("c", "text", rule("b", "is", "X"))];
    expect(pruneHiddenAnswers(chain, { a: "No", b: "X", c: "deep" })).toEqual({ a: "No" });
  });

  it("returns the same answers for a form without rules", () => {
    const plain = [q("a"), q("b")];
    const answers = { a: "1" };
    expect(pruneHiddenAnswers(plain, answers)).toBe(answers);
    expect(hiddenQuestionKeys(plain, answers)).toEqual([]);
  });
});

describe("visibleKeys", () => {
  it("lists every key of a form without rules", () => {
    expect([...visibleKeys([q("a"), q("b")], {})]).toEqual(["a", "b"]);
  });
});

describe("source helpers", () => {
  it("allows every answerable type except skills ratings", () => {
    for (const type of [
      "select", "radio", "scale", "checkbox", "reference", "number", "date", "text",
      "textarea", "email", "github_url", "figma_url", "drive_url", "file",
    ] as const) {
      expect(canBeSource(q("x", type))).toBe(true);
    }
    for (const type of ["skills_rating", "info", "pageBreak"] as const) {
      expect(canBeSource(q("x", type))).toBe(false);
      expect(opsForSource(q("x", type))).toEqual([]);
      expect(valuesForSource(q("x", type))).toEqual([]);
    }
  });

  it("offers the operators that fit each type", () => {
    for (const type of ["select", "radio", "reference"] as const) {
      expect(opsForSource(q("x", type))).toEqual(["is", "isNot", "answered", "blank"]);
    }
    expect(opsForSource(q("x", "scale"))).toEqual(["is", "isNot", "atLeast", "atMost", "answered", "blank"]);
    expect(opsForSource(q("x", "checkbox"))).toEqual(["includes", "excludes", "answered", "blank"]);
    for (const type of ["number", "date"] as const) {
      expect(opsForSource(q("x", type))).toEqual(["atLeast", "atMost", "answered", "blank"]);
    }
    for (const type of ["text", "textarea", "email", "github_url", "figma_url", "drive_url"] as const) {
      expect(opsForSource(q("x", type))).toEqual(["contains", "answered", "blank"]);
    }
    expect(opsForSource(q("x", "file"))).toEqual(["answered", "blank"]);
  });

  it("offers 1 to 5 for scale, the options otherwise, and Other when a write-in is allowed", () => {
    expect(valuesForSource(q("x", "scale"))).toEqual(["1", "2", "3", "4", "5"]);
    expect(valuesForSource(q("x", "radio", { options: ["A"], allowOther: true }))).toEqual(["A", OTHER_VALUE]);
    expect(valuesForSource(q("x", "checkbox", { options: ["A"], allowOther: true }))).toEqual(["A", OTHER_VALUE]);
    expect(valuesForSource(q("x", "radio", { options: ["A"] }))).toEqual(["A"]);
  });

  it("offers a Database list's rows only once they are loaded", () => {
    expect(valuesForSource(q("x", "reference"))).toEqual([]);
    const loaded = q("x", "reference", { referenceOptions: [{ value: "p1", label: "Atlas" }] });
    expect(valuesForSource(loaded)).toEqual(["p1"]);
  });

  it("never offers Other when an option has a {{token}}", () => {
    const source = q("x", "radio", { options: ["A", "In {{term}}"], allowOther: true });
    expect(valuesForSource(source)).toEqual(["A"]);
  });

  it("picks the input for each operator", () => {
    expect(valueInput(q("x", "select"), "is")).toBe("pick");
    expect(valueInput(q("x", "checkbox"), "excludes")).toBe("pick");
    expect(valueInput(q("x", "scale"), "atLeast")).toBe("pickOne");
    expect(valueInput(q("x", "number"), "atMost")).toBe("number");
    expect(valueInput(q("x", "date"), "atLeast")).toBe("date");
    expect(valueInput(q("x", "text"), "contains")).toBe("text");
    expect(valueInput(q("x", "file"), "answered")).toBe("none");
    expect(valueInput(q("x", "select"), "blank")).toBe("none");
  });

  it("starts a new condition on the first option, a middle rating, or nothing", () => {
    expect(defaultCondition(yesNo("a"))).toEqual({ questionKey: "a", op: "is", values: ["Yes"] });
    expect(defaultCondition(q("s", "scale"), "atLeast")).toEqual({ questionKey: "s", op: "atLeast", values: ["3"] });
    expect(defaultCondition(q("t", "text"))).toEqual({ questionKey: "t", op: "contains", values: [] });
    const loaded = q("r", "reference", { referenceOptions: [{ value: "p1", label: "Atlas" }] });
    expect(defaultCondition(loaded)).toEqual({ questionKey: "r", op: "is", values: [] });
  });

  it("never offers an option written with a {{token}}, and rejects a rule on one", () => {
    const source = q("x", "select", { options: ["Yes", "Off in {{term}}"] });
    expect(valuesForSource(source)).toEqual(["Yes"]);

    const rule = { questionKey: "x", op: "is" as const, value: "Off in {{term}}" };
    expect(showIfProblems([source, q("y", "text", { showIf: rule })])).toHaveLength(1);
    expect(valuesForSource(q("x", "select"))).toEqual([]);
  });
});

describe("showIfProblems", () => {
  it("is empty for a form without rules and for valid rules", () => {
    expect(showIfProblems([q("a"), q("b")])).toEqual([]);
    expect(
      showIfProblems([
        yesNo("a"),
        q("b", "text", rule("a", "is", "Yes")),
        q("c", "checkbox", { options: ["X"] }),
        q("d", "text", rule("c", "excludes", "X")),
        q("e", "scale"),
        q("f", "text", rule("e", "isNot", "5")),
      ]),
    ).toEqual([]);
  });

  it("rejects a deleted source and names the question", () => {
    const [p] = showIfProblems([q("b", "text", { label: "Why?", ...rule("gone", "is", "Yes") })]);
    expect(p.key).toBe("b");
    expect(p.message).toBe('"Why?" depends on a question that was deleted.');
  });

  it("rejects a source that comes after the question", () => {
    const [p] = showIfProblems([
      q("b", "text", { label: "Why?", ...rule("a", "is", "Yes") }),
      yesNo("a"),
    ]);
    expect(p.message).toBe('"Why?" depends on "a", which now comes after it.');
  });

  it("rejects a source of a type that cannot be a source", () => {
    const [p] = showIfProblems([q("a", "skills_rating"), q("b", "text", rule("a", "is", "Yes"))]);
    expect(p.message).toContain("can't be used in a condition");
  });

  it("rejects an option that is no longer there", () => {
    const [p] = showIfProblems([yesNo("a"), q("b", "text", rule("a", "is", "Maybe"))]);
    expect(p.message).toContain('"Maybe", which is no longer an option');
  });

  it("rejects a scale value outside 1 to 5", () => {
    const [p] = showIfProblems([q("a", "scale"), q("b", "text", rule("a", "is", "6"))]);
    expect(p.message).toContain('"6"');
  });

  it("rejects an operator that does not fit the source type", () => {
    const bad = [
      [yesNo("a"), q("b", "text", rule("a", "includes", "Yes"))],
      [q("a", "checkbox", { options: ["X"] }), q("b", "text", rule("a", "is", "X"))],
      [q("a", "radio", { options: ["X", "Y"] }), q("b", "text", rule("a", "excludes", "X"))],
    ];
    for (const form of bad) {
      expect(showIfProblems(form)[0].message).toContain("doesn't fit");
    }
  });

  it("rejects an unknown operator", () => {
    const form = [yesNo("a"), q("b", "text", { showIf: { questionKey: "a", op: "nope" as never, value: "Yes" } })];
    expect(showIfProblems(form)).toHaveLength(1);
  });

  it("allows a rule on a page break", () => {
    expect(showIfProblems([yesNo("a"), { ...brk("p"), data: { label: "", ...rule("a", "is", "Yes") } }])).toEqual([]);
  });

  it("rejects a page rule when a question on that page is mapped", () => {
    const mapped = new Map([["c", "Project Bids"]]);
    const form = [
      yesNo("a"),
      { ...brk("p"), data: { label: "Design", ...rule("a", "is", "Yes") } },
      q("b"),
      q("c", "text", { label: "Portfolio" }),
      q("d"),
    ];
    expect(showIfProblems(form, mapped)).toEqual([
      { key: "p", message: '"Design" can\'t have a condition because "Portfolio" on its page is used by Project Bids.' },
    ]);
  });

  it("does not blame a page rule for a mapped question on the next page", () => {
    const mapped = new Map([["c", "Project Bids"]]);
    const form = [yesNo("a"), { ...brk("p"), data: { label: "", ...rule("a", "is", "Yes") } }, q("b"), brk("p2"), q("c")];
    expect(showIfProblems(form, mapped)).toEqual([]);
  });

  it("rejects a mapped question and names the feature", () => {
    const mapped = new Map([["b", "Project Bids"]]);
    const [p] = showIfProblems([yesNo("a"), q("b", "text", rule("a", "is", "Yes"))], mapped);
    expect(p.message).toBe('"b" is used by Project Bids and always has to be shown.');
  });

  it("allows a rule on an unmapped question when others are mapped", () => {
    const mapped = new Map([["a", "Project Bids"]]);
    expect(showIfProblems([yesNo("a"), q("b", "text", rule("a", "is", "Yes"))], mapped)).toEqual([]);
  });

  it("names an untitled question", () => {
    const [p] = showIfProblems([q("b", "text", { label: " ", ...rule("gone", "is", "x") })]);
    expect(p.message).toBe("An untitled question depends on a question that was deleted.");
  });

  it("reports every bad rule", () => {
    const form = [
      q("b", "text", rule("gone", "is", "x")),
      q("c", "text", rule("gone", "is", "x")),
    ];
    expect(showIfProblems(form).map((p) => p.key)).toEqual(["b", "c"]);
  });
});

describe("sentences, numbers and depth", () => {
  const form = [
    q("intro", "info"),
    yesNo("a"),
    q("b", "checkbox", { options: ["Design"] }),
    q("c", "text", rule("b", "includes", "Design")),
  ];
  const numbers = questionNumbers(form);

  it("numbers questions and skips layout blocks", () => {
    expect([...numbers]).toEqual([["a", 1], ["b", 2], ["c", 3]]);
  });

  it("writes the shown-when sentence for each operator", () => {
    expect(showIfSentence({ questionKey: "a", op: "is", value: "No" }, numbers)).toBe("Q1 is No");
    expect(showIfSentence({ questionKey: "a", op: "isNot", value: "No" }, numbers)).toBe("Q1 is not No");
    expect(showIfSentence({ questionKey: "b", op: "includes", value: "Design" }, numbers)).toBe("Q2 includes Design");
    expect(showIfSentence({ questionKey: "b", op: "excludes", value: "Design" }, numbers)).toBe("Q2 doesn't include Design");
    expect(showIfSentence({ questionKey: "x", op: "is", value: "No" }, numbers)).toBe("A deleted question is No");
  });


  it("nests chains one level per hop", () => {
    const chain = [
      yesNo("a"),
      q("b", "select", { options: ["X"], ...rule("a", "is", "Yes") }),
      q("c", "text", rule("b", "is", "X")),
      q("d", "text", rule("gone", "is", "X")),
      q("e"),
    ];
    expect([...ruleDepths(chain)]).toEqual([["a", 0], ["b", 1], ["c", 2], ["d", 0], ["e", 0]]);
  });
});

const when = (questionKey: string, op: ShowIfOp, ...values: string[]) => ({ questionKey, op, values });
const all = (...conditions: ReturnType<typeof when>[]) => ({ showIf: { match: "all" as const, conditions } });
const any = (...conditions: ReturnType<typeof when>[]) => ({ showIf: { match: "any" as const, conditions } });
const shown = (form: Question[], answers: Record<string, unknown>) => keys(visibleQuestions(form, answers));

describe("visibleQuestions: any of several values", () => {
  const pick = q("a", "select", { options: ["Design", "Eng", "PM"] });

  it("is matches any picked value and isNot matches none of them", () => {
    const is = [pick, q("b", "text", all(when("a", "is", "Design", "PM")))];
    const isNot = [pick, q("b", "text", all(when("a", "isNot", "Design", "PM")))];
    expect(shown(is, { a: "PM" })).toEqual(["a", "b"]);
    expect(shown(is, { a: "Eng" })).toEqual(["a"]);
    expect(shown(isNot, { a: "Eng" })).toEqual(["a", "b"]);
    expect(shown(isNot, { a: "Design" })).toEqual(["a"]);
  });

  it("includes matches any picked value and excludes none of them", () => {
    const box = q("a", "checkbox", { options: ["Design", "Eng", "PM"] });
    const includes = [box, q("b", "text", all(when("a", "includes", "Design", "PM")))];
    const excludes = [box, q("b", "text", all(when("a", "excludes", "Design", "PM")))];
    expect(shown(includes, { a: ["Eng", "PM"] })).toEqual(["a", "b"]);
    expect(shown(includes, { a: ["Eng"] })).toEqual(["a"]);
    expect(shown(excludes, { a: ["Eng"] })).toEqual(["a", "b"]);
    expect(shown(excludes, { a: ["Eng", "Design"] })).toEqual(["a"]);
  });

  it("matches a Database list by the stored row id", () => {
    const form = [q("a", "reference"), q("b", "text", all(when("a", "is", "p1", "p2")))];
    expect(shown(form, { a: "p2" })).toEqual(["a", "b"]);
    expect(shown(form, { a: "p3" })).toEqual(["a"]);
  });
});

describe("visibleQuestions: Other", () => {
  it("matches a radio write-in as Other, and never a listed option", () => {
    const radio = q("a", "radio", { options: ["Yes", "No"], allowOther: true });
    const form = [radio, q("b", "text", all(when("a", "is", OTHER_VALUE)))];
    expect(shown(form, { a: "Maybe" })).toEqual(["a", "b"]);
    expect(shown(form, { a: "Yes" })).toEqual(["a"]);
    expect(shown(form, {})).toEqual(["a"]);
  });

  it("matches a checkbox write-in among the picks", () => {
    const box = q("a", "checkbox", { options: ["X", "Y"], allowOther: true });
    const includes = [box, q("b", "text", all(when("a", "includes", OTHER_VALUE)))];
    const excludes = [box, q("b", "text", all(when("a", "excludes", OTHER_VALUE)))];
    expect(shown(includes, { a: ["X", "Something"] })).toEqual(["a", "b"]);
    expect(shown(includes, { a: ["X"] })).toEqual(["a"]);
    expect(shown(excludes, { a: ["X"] })).toEqual(["a", "b"]);
  });

  it("never matches Other once the write-in is turned off", () => {
    const radio = q("a", "radio", { options: ["Yes", "No"] });
    const form = [radio, q("b", "text", all(when("a", "is", OTHER_VALUE)))];
    expect(shown(form, { a: "Maybe" })).toEqual(["a"]);
  });
});

describe("visibleQuestions: at least and at most", () => {
  it("compares a scale rating, inclusive at both ends", () => {
    const low = [q("a", "scale"), q("b", "text", all(when("a", "atMost", "2")))];
    const high = [q("a", "scale"), q("b", "text", all(when("a", "atLeast", "4")))];
    expect(shown(low, { a: "1" })).toEqual(["a", "b"]);
    expect(shown(low, { a: "2" })).toEqual(["a", "b"]);
    expect(shown(low, { a: "3" })).toEqual(["a"]);
    expect(shown(high, { a: 4 })).toEqual(["a", "b"]);
    expect(shown(high, { a: "3" })).toEqual(["a"]);
  });

  it("compares numbers as numbers, not text", () => {
    const form = [q("a", "number"), q("b", "text", all(when("a", "atLeast", "9")))];
    expect(shown(form, { a: "10" })).toEqual(["a", "b"]);
    expect(shown(form, { a: "8.5" })).toEqual(["a"]);
    expect(shown(form, { a: "-20" })).toEqual(["a"]);
    const negative = [q("a", "number"), q("b", "text", all(when("a", "atMost", "-1.5")))];
    expect(shown(negative, { a: "-2" })).toEqual(["a", "b"]);
  });

  it("compares dates by day", () => {
    const after = [q("a", "date"), q("b", "text", all(when("a", "atLeast", "2027-01-01")))];
    const before = [q("a", "date"), q("b", "text", all(when("a", "atMost", "2027-01-01")))];
    expect(shown(after, { a: "2027-01-01" })).toEqual(["a", "b"]);
    expect(shown(after, { a: "2026-12-31" })).toEqual(["a"]);
    expect(shown(before, { a: "2026-12-31" })).toEqual(["a", "b"]);
    expect(shown(before, { a: "2027-03-01" })).toEqual(["a"]);
  });

  it("hides when the answer or the bound is blank or unreadable", () => {
    const form = (bound: string[]) => [q("a", "number"), q("b", "text", all(when("a", "atLeast", ...bound)))];
    for (const answers of [{}, { a: "" }, { a: "ten" }, { a: null }]) {
      expect(shown(form(["1"]), answers)).toEqual(["a"]);
    }
    expect(shown(form([]), { a: "5" })).toEqual(["a"]);
    expect(shown(form(["x"]), { a: "5" })).toEqual(["a"]);
    const date = [q("a", "date"), q("b", "text", all(when("a", "atLeast", "2027-01-01")))];
    expect(shown(date, { a: "Jan 2" })).toEqual(["a"]);
  });
});

describe("visibleQuestions: contains, answered and blank", () => {
  it("contains matches text anywhere, ignoring case", () => {
    const form = [q("a", "github_url"), q("b", "text", all(when("a", "contains", " GitHub.com/dali ")))];
    expect(shown(form, { a: "https://github.com/DALI-lab/x" })).toEqual(["a", "b"]);
    expect(shown(form, { a: "https://gitlab.com/x" })).toEqual(["a"]);
    expect(shown(form, {})).toEqual(["a"]);
  });

  it("contains with no text never matches", () => {
    const form = [q("a", "text"), q("b", "text", all(when("a", "contains", "  ")))];
    expect(shown(form, { a: "anything" })).toEqual(["a"]);
  });

  it("answered and blank follow whether there is an answer", () => {
    const cases: [Question, unknown, unknown][] = [
      [q("a", "text"), "hi", "  "],
      [q("a", "number"), "0", ""],
      [q("a", "number"), 0, undefined],
      [q("a", "checkbox", { options: ["X"] }), ["X"], []],
      [q("a", "checkbox", { options: ["X"] }), JSON.stringify(["X"]), "[]"],
      [q("a", "select", { options: ["X"] }), "X", null],
      [q("a", "file"), "uploads/cv.pdf", ""],
      [q("a", "file", { maxFiles: 3 }), JSON.stringify(["uploads/a.pdf", "uploads/b.pdf"]), "[]"],
      [q("a", "file", { maxFiles: 3 }), ["uploads/a.pdf"], [""]],
    ];
    for (const [source, filled, empty] of cases) {
      const answered = [source, q("b", "text", all(when("a", "answered")))];
      const blank = [source, q("b", "text", all(when("a", "blank")))];
      expect(shown(answered, { a: filled })).toEqual(["a", "b"]);
      expect(shown(answered, { a: empty })).toEqual(["a"]);
      expect(shown(blank, { a: empty })).toEqual(["a", "b"]);
      expect(shown(blank, { a: filled })).toEqual(["a"]);
    }
  });

  it("blank hides when its source was not shown", () => {
    const form = [
      yesNo("a"),
      q("b", "text", rule("a", "is", "Yes")),
      q("c", "text", all(when("b", "blank"))),
    ];
    expect(shown(form, { a: "No" })).toEqual(["a"]);
    expect(shown(form, { a: "Yes" })).toEqual(["a", "b", "c"]);
  });

  it("hides when an operator doesn't fit its source", () => {
    const form = [q("a", "text"), q("b", "text", all(when("a", "atLeast", "1")))];
    expect(shown(form, { a: "5" })).toEqual(["a"]);
  });
});

describe("visibleQuestions: several conditions", () => {
  const form = (match: "all" | "any") => [
    yesNo("a"),
    q("s", "scale"),
    q("b", "text", (match === "all" ? all : any)(when("a", "is", "Yes"), when("s", "atLeast", "4"))),
  ];

  it("all needs every condition", () => {
    expect(shown(form("all"), { a: "Yes", s: "5" })).toEqual(["a", "s", "b"]);
    expect(shown(form("all"), { a: "Yes", s: "2" })).toEqual(["a", "s"]);
    expect(shown(form("all"), { a: "No", s: "5" })).toEqual(["a", "s"]);
  });

  it("any needs one condition", () => {
    expect(shown(form("any"), { a: "No", s: "5" })).toEqual(["a", "s", "b"]);
    expect(shown(form("any"), { a: "Yes", s: "1" })).toEqual(["a", "s", "b"]);
    expect(shown(form("any"), { a: "No", s: "1" })).toEqual(["a", "s"]);
  });

  it("any still shows when one source is hidden and another matches", () => {
    const chain = [
      yesNo("a"),
      q("m", "select", { options: ["X"], ...rule("a", "is", "Yes") }),
      q("b", "text", any(when("m", "is", "X"), when("a", "is", "No"))),
    ];
    expect(shown(chain, { a: "No", m: "X" })).toEqual(["a", "b"]);
  });

  it("hides a question whose rule has no conditions", () => {
    const form = [yesNo("a"), q("b", "text", { showIf: { match: "any", conditions: [] } })];
    expect(shown(form, { a: "Yes" })).toEqual(["a"]);
  });
});

describe("visibleQuestions: page rules", () => {
  const page = (key: string, showIf: Question["data"]["showIf"], label = "") => ({
    ...brk(key),
    data: { label, showIf },
  });
  const form = [
    yesNo("a"),
    page("p", rule("a", "is", "Yes").showIf, "Design"),
    q("b"),
    q("note", "info"),
    q("c", "select", { options: ["X"] }),
    brk("p2"),
    q("d"),
    q("e", "text", rule("c", "is", "X")),
  ];

  it("hides every question on the page, up to the next page break", () => {
    expect(shown(form, { a: "No", c: "X" })).toEqual(["a", "p2", "d"]);
    expect(shown(form, { a: "Yes", c: "X" })).toEqual(["a", "p", "b", "note", "c", "p2", "d", "e"]);
  });

  it("drops the page and keeps the others", () => {
    const pages = visiblePages(form, { a: "No" });
    expect(pages.map((p) => keys(p.questions))).toEqual([["a"], ["d"]]);
    expect(visiblePages(form, { a: "Yes" }).map((p) => p.title)).toEqual([undefined, "Design", "p2"]);
  });

  it("prunes answers on a hidden page", () => {
    expect(pruneHiddenAnswers(form, { a: "No", b: "x", c: "X", d: "y", e: "z" })).toEqual({ a: "No", d: "y" });
  });

  it("combines a page rule with a question's own rule", () => {
    const both = [yesNo("a"), q("s", "scale"), page("p", rule("a", "is", "Yes").showIf), q("b", "text", all(when("s", "atLeast", "4")))];
    expect(shown(both, { a: "Yes", s: "5" })).toEqual(["a", "s", "p", "b"]);
    expect(shown(both, { a: "Yes", s: "1" })).toEqual(["a", "s", "p"]);
    expect(shown(both, { a: "No", s: "5" })).toEqual(["a", "s"]);
  });

  it("lists questions on a conditional page as conditional", () => {
    expect([...conditionalKeys(form)]).toEqual(["b", "note", "c", "e"]);
  });
});

describe("rule shapes", () => {
  it("reads a rule saved as one condition", () => {
    expect(ruleOf({ questionKey: "a", op: "is", value: "Yes" })).toEqual({
      match: "all",
      conditions: [{ questionKey: "a", op: "is", values: ["Yes"] }],
    });
    expect(ruleOf({ questionKey: "a", op: "answered" })).toEqual({
      match: "all",
      conditions: [{ questionKey: "a", op: "answered", values: [] }],
    });
  });

  it("reads a rule with several conditions and falls back to all", () => {
    const rule = ruleOf({ match: "nope" as never, conditions: [{ questionKey: "a", op: "is", values: ["X", 3 as never] }] });
    expect(rule).toEqual({ match: "all", conditions: [{ questionKey: "a", op: "is", values: ["X"] }] });
    expect(ruleOf(undefined)).toBeNull();
  });

  it("writes conditions with values and drops empty labels", () => {
    expect(
      toShowIf({
        match: "any",
        conditions: [
          { questionKey: "a", op: "is", values: ["p1"], labels: ["Atlas"] },
          { questionKey: "b", op: "answered", values: [], labels: [] },
        ],
      }),
    ).toEqual({
      match: "any",
      conditions: [
        { questionKey: "a", op: "is", values: ["p1"], labels: ["Atlas"] },
        { questionKey: "b", op: "answered", values: [] },
      ],
    });
  });
});

describe("showIfProblems: new operators", () => {
  const problem = (source: Question, op: ShowIfOp, ...values: string[]) =>
    showIfProblems([source, q("b", "text", { label: "Why?", ...all(when("a", op, ...values)) })])[0]?.message;

  it("accepts valid conditions of every kind", () => {
    expect(problem(q("a", "scale"), "atLeast", "4")).toBeUndefined();
    expect(problem(q("a", "number"), "atMost", "-2.5")).toBeUndefined();
    expect(problem(q("a", "date"), "atLeast", "2027-01-01")).toBeUndefined();
    expect(problem(q("a", "text"), "contains", "react")).toBeUndefined();
    expect(problem(q("a", "file"), "answered")).toBeUndefined();
    expect(problem(yesNo("a"), "is", "Yes", "No")).toBeUndefined();
    expect(problem(q("a", "radio", { options: ["X", "Y"], allowOther: true }), "is", OTHER_VALUE)).toBeUndefined();
    expect(problem(q("a", "reference"), "is", "any-row-id")).toBeUndefined();
  });

  it("needs at least one picked answer", () => {
    expect(problem(yesNo("a"), "is")).toBe('"Why?" has a condition with no answer picked.');
    expect(problem(q("a", "reference"), "isNot")).toBe('"Why?" has a condition with no answer picked.');
  });

  it("names a picked answer that is gone, including Other", () => {
    expect(problem(yesNo("a"), "is", "Yes", "Maybe")).toBe(
      '"Why?" depends on "Maybe", which is no longer an option of "a".',
    );
    expect(problem(q("a", "radio", { options: ["X", "Y"] }), "is", OTHER_VALUE)).toBe(
      '"Why?" depends on "Other", which is no longer an option of "a".',
    );
  });

  it("needs a rating from 1 to 5, a number, a date or some text", () => {
    expect(problem(q("a", "scale"), "atLeast", "7")).toContain('"7"');
    expect(problem(q("a", "scale"), "atMost")).toContain("no longer an option");
    expect(problem(q("a", "number"), "atLeast", "ten")).toBe('"Why?" needs a number in its condition.');
    expect(problem(q("a", "number"), "atLeast")).toBe('"Why?" needs a number in its condition.');
    expect(problem(q("a", "date"), "atMost", "01/02/2027")).toBe('"Why?" needs a date in its condition.');
    expect(problem(q("a", "email"), "contains", " ")).toBe('"Why?" needs some text in its condition.');
  });

  it("rejects an empty rule", () => {
    const [p] = showIfProblems([yesNo("a"), q("b", "text", { label: "Why?", showIf: { match: "all", conditions: [] } })]);
    expect(p.message).toBe('"Why?" has a condition with nothing in it.');
  });

  it("reports the first bad condition once per question", () => {
    const form = [yesNo("a"), q("b", "text", all(when("a", "is", "Yes"), when("gone", "is", "x"), when("a", "is", "Maybe")))];
    expect(showIfProblems(form)).toEqual([{ key: "b", message: '"b" depends on a question that was deleted.' }]);
  });
});

describe("sentences for the new rules", () => {
  const form = [
    q("a", "select", { options: ["Design", "Eng", "PM"] }),
    q("s", "scale"),
    q("d", "date"),
    q("t", "text"),
    q("r", "reference", { referenceOptions: [{ value: "p1", label: "Atlas" }] }),
    q("o", "radio", { options: ["X"], allowOther: true }),
  ];
  const numbers = questionNumbers(form);
  const sentence = (showIf: Question["data"]["showIf"]) => showIfSentence(showIf!, numbers, form);

  it("joins several values with or", () => {
    expect(sentence(when("a", "is", "Design", "PM"))).toBe("Q1 is Design or PM");
  });

  it("writes ranges, text and presence", () => {
    expect(sentence(when("s", "atMost", "2"))).toBe("Q2 is at most 2");
    expect(sentence(when("d", "atLeast", "2027-01-01"))).toBe("Q3 is on or after 2027-01-01");
    expect(sentence(when("d", "atMost", "2027-01-01"))).toBe("Q3 is on or before 2027-01-01");
    expect(sentence(when("t", "contains", "react"))).toBe('Q4 contains "react"');
    expect(sentence(when("t", "blank"))).toBe("Q4 is blank");
    expect(sentence(when("t", "answered"))).toBe("Q4 is answered");
  });

  it("names Other and Database list rows by label", () => {
    expect(sentence(when("o", "is", OTHER_VALUE))).toBe("Q6 is Other");
    expect(sentence(when("r", "is", "p1"))).toBe("Q5 is Atlas");
    expect(sentence({ questionKey: "r", op: "is", values: ["p2"], labels: ["Borealis"] })).toBe("Q5 is Borealis");
  });

  it("joins conditions with and or or", () => {
    expect(sentence(all(when("a", "is", "PM"), when("s", "atLeast", "4")).showIf)).toBe("Q1 is PM and Q2 is at least 4");
    expect(sentence(any(when("a", "is", "PM"), when("t", "answered")).showIf)).toBe("Q1 is PM or Q4 is answered");
  });

  it("says what decides a question on a conditional page", () => {
    const paged = [
      yesNo("a"),
      { ...brk("p"), data: { label: "", ...rule("a", "is", "Yes") } },
      q("s", "scale"),
      q("b", "text", all(when("s", "atLeast", "4"))),
      q("c"),
    ];
    expect(shownWhenSentence(paged, "b")).toBe("Q1 is Yes and Q2 is at least 4");
    expect(shownWhenSentence(paged, "c")).toBe("Q1 is Yes");
    expect(shownWhenSentence(paged, "a")).toBe("");
  });

  it("nests by the deepest source and never nests a page break", () => {
    const chain = [
      yesNo("a"),
      q("b", "select", { options: ["X"], ...rule("a", "is", "Yes") }),
      q("c", "text", all(when("a", "is", "No"), when("b", "is", "X"))),
      { ...brk("p"), data: { label: "", ...rule("b", "is", "X") } },
    ];
    expect([...ruleDepths(chain)]).toEqual([["a", 0], ["b", 1], ["c", 2], ["p", 0]]);
  });
});
