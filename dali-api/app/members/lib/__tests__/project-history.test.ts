import { describe, expect, it } from "vitest";
import { groupAssignmentsByTerm } from "../project-history";

const t26F = { id: "t26F", code: "26F", sortKey: 20264 };
const t26S = { id: "t26S", code: "26S", sortKey: 20262 };
const t27W = { id: "t27W", code: "27W", sortKey: 20271 };
const t25F = { id: "t25F", code: "25F", sortKey: 20254 };

describe("groupAssignmentsByTerm", () => {
  it("returns no groups for no assignments", () => {
    expect(groupAssignmentsByTerm([], "t26F")).toEqual([]);
  });

  it("groups by term, newest term first by sortKey, not by code", () => {
    const groups = groupAssignmentsByTerm(
      [
        { id: "a", term: t25F },
        { id: "b", term: t26S },
        { id: "c", term: t26F },
        { id: "d", term: t27W },
      ],
      "t26F",
    );
    expect(groups.map((g) => g.termCode)).toEqual(["27W", "26F", "26S", "25F"]);
  });

  it("keeps every assignment in its term, in input order", () => {
    const groups = groupAssignmentsByTerm(
      [
        { id: "a", term: t26S },
        { id: "b", term: t26F },
        { id: "c", term: t26S },
      ],
      "t26F",
    );
    expect(groups.map((g) => g.assignments.map((a) => a.id))).toEqual([["b"], ["a", "c"]]);
  });

  it("flags only the current term", () => {
    const groups = groupAssignmentsByTerm(
      [
        { id: "a", term: t26S },
        { id: "b", term: t26F },
      ],
      "t26F",
    );
    expect(groups.map((g) => g.isCurrent)).toEqual([true, false]);
  });

  it("flags nothing as current when there is no current term", () => {
    const groups = groupAssignmentsByTerm([{ id: "a", term: t26S }], null);
    expect(groups[0].isCurrent).toBe(false);
  });
});
