import { describe, it, expect } from "vitest";
import {
  columnKey,
  orderedColumns,
  visibleColumns,
  rowCells,
} from "../submission-columns";
import type { ColumnMapping } from "../slot-roles";

const m: ColumnMapping = {
  version: 1,
  entries: [
    { source: "builtin", builtin: "submitter", role: "submitter", label: "By", order: 2 },
    { source: "question", questionKey: "p1", role: "project", label: "1st choice", order: 0 },
    {
      source: "question",
      questionKey: "why",
      role: "display",
      label: "Why",
      order: 1,
      hidden: true,
    },
  ],
};

describe("submission-columns", () => {
  it("orders columns by `order`, not array position", () => {
    expect(orderedColumns(m).map((c) => c.label)).toEqual([
      "1st choice",
      "Why",
      "By",
    ]);
  });

  it("an absent mapping yields no columns", () => {
    expect(orderedColumns(null)).toEqual([]);
    expect(visibleColumns(null)).toEqual([]);
  });

  it("visibleColumns drops hidden ones; detail (ordered) keeps them", () => {
    expect(visibleColumns(m).map((c) => c.label)).toEqual([
      "1st choice",
      "By",
    ]);
    expect(orderedColumns(m).map((c) => c.label)).toContain("Why");
  });

  it("question and builtin columns get distinct stable keys", () => {
    const keys = orderedColumns(m).map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("rowCells resolves question + builtin values and blanks the rest", () => {
    const cells = rowCells(m, {
      answerText: { p1: "Project Alpha" },
      builtinText: { submitter: "Ada L." },
    });
    expect(cells[columnKey(m.entries[1])]).toBe("Project Alpha"); // p1
    expect(cells[columnKey(m.entries[0])]).toBe("Ada L."); // submitter
    expect(cells[columnKey(m.entries[2])]).toBe(""); // "why" unanswered
  });

  it("a per-term column keys separately per term", () => {
    const perTerm: ColumnMapping = {
      version: 1,
      entries: [
        { source: "question", questionKey: "s", role: "intent-status", label: "Fall", termId: "t1", order: 0 },
        { source: "question", questionKey: "s", role: "intent-status", label: "Winter", termId: "t2", order: 1 },
      ],
    };
    const keys = orderedColumns(perTerm).map((c) => c.key);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("term token in column labels", () => {
  // A cycle-term status column stores {{term}} in its label rather than a term
  // code, so the board reads it as whichever cycle is in view.
  const cycleTerm: ColumnMapping = {
    version: 1,
    entries: [
      {
        source: "question",
        questionKey: "q-status",
        role: "intent-status",
        label: "Status — {{term}}",
        order: 0,
      },
    ],
  };

  it("resolves the token to the cycle's term code", () => {
    expect(orderedColumns(cycleTerm, "27S")[0].label).toBe("Status — 27S");
    expect(visibleColumns(cycleTerm, "27S")[0].label).toBe("Status — 27S");
  });

  it("leaves the token literal for the all-terms aggregate, which has no one term", () => {
    expect(orderedColumns(cycleTerm)[0].label).toBe("Status — {{term}}");
    expect(orderedColumns(cycleTerm, null)[0].label).toBe("Status — {{term}}");
  });

  it("leaves labels without the token untouched", () => {
    expect(orderedColumns(m, "27S").map((c) => c.label)).toEqual([
      "1st choice",
      "Why",
      "By",
    ]);
  });
});
