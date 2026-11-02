import { describe, it, expect } from "vitest";
import {
  audienceSentence,
  canBeSource,
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
  type ShowIf,
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
const rule = (questionKey: string, op: ShowIf["op"], value: string) => ({
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
      const form = (op: ShowIf["op"]) => [q("a", type, data), q("b", "text", rule("a", op, match))];

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
  const form = (op: ShowIf["op"]) => [box, q("b", "text", rule("a", op, "Design"))];

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

  it("ignores a rule on a page break", () => {
    const form = [yesNo("a"), { ...brk("p"), data: { label: "", ...rule("a", "is", "No") } }];
    expect(keys(visibleQuestions(form, { a: "Yes" }))).toEqual(["a", "p"]);
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
  it("allows only select, radio, scale and checkbox sources", () => {
    for (const type of ["select", "radio", "scale", "checkbox"] as const) {
      expect(canBeSource(q("x", type))).toBe(true);
    }
    for (const type of [
      "text", "textarea", "date", "number", "email", "github_url", "figma_url",
      "drive_url", "file", "skills_rating", "reference", "info", "pageBreak",
    ] as const) {
      expect(canBeSource(q("x", type))).toBe(false);
      expect(opsForSource(q("x", type))).toEqual([]);
      expect(valuesForSource(q("x", type))).toEqual([]);
    }
  });

  it("offers is and isNot for single choices, includes and excludes for checkboxes", () => {
    for (const type of ["select", "radio", "scale"] as const) {
      expect(opsForSource(q("x", type))).toEqual(["is", "isNot"]);
    }
    expect(opsForSource(q("x", "checkbox"))).toEqual(["includes", "excludes"]);
  });

  it("offers 1 to 5 for scale and the options otherwise, never the Other write-in", () => {
    expect(valuesForSource(q("x", "scale"))).toEqual(["1", "2", "3", "4", "5"]);
    expect(valuesForSource(q("x", "radio", { options: ["A"], allowOther: true }))).toEqual(["A"]);
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
    const [p] = showIfProblems([q("a", "text"), q("b", "text", rule("a", "is", "Yes"))]);
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

  it("rejects a rule on a page break", () => {
    const [p] = showIfProblems([yesNo("a"), { ...brk("p"), data: { label: "", ...rule("a", "is", "Yes") } }]);
    expect(p.message).toBe("A page break can't have a condition.");
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

  it("writes the audience sentence", () => {
    expect(audienceSentence({ questionKey: "b", op: "includes", value: "Design" }, numbers)).toBe("who picked Design in Q2");
    expect(audienceSentence({ questionKey: "a", op: "is", value: "No" }, numbers)).toBe("who picked No in Q1");
    expect(audienceSentence({ questionKey: "a", op: "isNot", value: "No" }, numbers)).toBe("who didn't pick No in Q1");
    expect(audienceSentence({ questionKey: "b", op: "excludes", value: "Design" }, numbers)).toBe("who didn't pick Design in Q2");
    expect(audienceSentence({ questionKey: "x", op: "is", value: "No" }, numbers)).toBe("who picked No in an earlier question");
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
