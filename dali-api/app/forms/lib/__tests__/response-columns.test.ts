import { describe, expect, it } from "vitest";
import {
  applyResultColumnOp,
  arrangeResultColumns,
  memberColumnKey,
  parseResultColumns,
  responseColumnId,
} from "../response-columns";

const QUESTIONS = [
  { key: "q1", label: "Role" },
  { key: "q2", label: "Days" },
  { key: "q3", label: "Notes" },
];

describe("member column ids", () => {
  it("round-trips a member column", () => {
    expect(memberColumnKey(responseColumnId("termsInLab"))).toBe("termsInLab");
  });

  it("reads anything else as not a member column", () => {
    expect(memberColumnKey("member:salary")).toBeNull();
    expect(memberColumnKey("q1")).toBeNull();
  });
});

describe("parseResultColumns", () => {
  it("reads entries and older plain member ids, dropping unknown members and repeats", () => {
    expect(
      parseResultColumns([
        "member:termsInLab",
        { id: "q2", label: "When", hidden: true },
        "member:gone",
        4,
        { id: "q2" },
        { id: "q1", label: "" },
      ]),
    ).toEqual([{ id: "member:termsInLab" }, { id: "q2", label: "When", hidden: true }, { id: "q1" }]);
  });

  it("is empty for a form with nothing saved", () => {
    expect(parseResultColumns(null)).toEqual([]);
    expect(parseResultColumns({ member: ["termsInLab"] })).toEqual([]);
  });
});

describe("arrangeResultColumns", () => {
  it("shows the questions in form order with nothing saved", () => {
    const a = arrangeResultColumns(QUESTIONS, []);
    expect(a.visible).toEqual(QUESTIONS);
    expect(a.members).toEqual([]);
    expect(a.hidden.map((c) => c.key)).toEqual([
      "member:hiredRoles",
      "member:projectHistory",
      "member:termsInLab",
      "member:currentRole",
    ]);
  });

  it("puts questions first for an older member-only save", () => {
    const a = arrangeResultColumns(QUESTIONS, [{ id: "member:termsInLab" }]);
    expect(a.visible.map((c) => c.key)).toEqual(["q1", "q2", "q3", "member:termsInLab"]);
    expect(a.members).toEqual(["termsInLab"]);
  });

  it("follows the saved order and labels, hides hidden columns and appends new questions", () => {
    const a = arrangeResultColumns(QUESTIONS, [
      { id: "q3", label: "Anything else" },
      { id: "member:currentRole" },
      { id: "q1", hidden: true },
      { id: "q9" },
    ]);
    expect(a.visible).toEqual([
      { key: "q3", label: "Anything else" },
      { key: "member:currentRole", label: "Current role" },
      { key: "q2", label: "Days" },
    ]);
    expect(a.hidden[0]).toEqual({ key: "q1", label: "Role" });
    expect(a.members).toEqual(["currentRole"]);
  });

  it("loads no member data for a hidden member column", () => {
    expect(arrangeResultColumns(QUESTIONS, [{ id: "q1" }, { id: "member:hiredRoles", hidden: true }]).members).toEqual([]);
  });
});

describe("applyResultColumnOp", () => {
  const ids = (list: { id: string }[] | null) => list?.map((e) => e.id);

  it("adds a member column at the end", () => {
    expect(ids(applyResultColumnOp([], { op: "show", id: "member:hiredRoles" }, QUESTIONS))).toEqual([
      "q1",
      "q2",
      "q3",
      "member:hiredRoles",
    ]);
  });

  it("shows a hidden column again at the end", () => {
    const next = applyResultColumnOp([{ id: "q1", hidden: true }], { op: "show", id: "q1" }, QUESTIONS);
    expect(next).toEqual([{ id: "q2" }, { id: "q3" }, { id: "q1" }]);
  });

  it("hides a column in place", () => {
    expect(applyResultColumnOp([], { op: "hide", id: "q2" }, QUESTIONS)).toEqual([
      { id: "q1" },
      { id: "q2", hidden: true },
      { id: "q3" },
    ]);
  });

  it("renames, and an empty name goes back to the question's", () => {
    const named = applyResultColumnOp([], { op: "rename", id: "q2", label: "When" }, QUESTIONS)!;
    expect(named[1]).toEqual({ id: "q2", label: "When" });
    expect(applyResultColumnOp(named, { op: "rename", id: "q2", label: "" }, QUESTIONS)![1]).toEqual({ id: "q2" });
  });

  it("moves past hidden columns and stops at the ends", () => {
    const config = [{ id: "q1" }, { id: "q2", hidden: true }, { id: "q3" }];
    expect(ids(applyResultColumnOp(config, { op: "move", id: "q3", dir: -1 }, QUESTIONS))).toEqual(["q3", "q2", "q1"]);
    expect(ids(applyResultColumnOp(config, { op: "move", id: "q1", dir: -1 }, QUESTIONS))).toEqual(["q1", "q2", "q3"]);
  });

  it("refuses unknown columns and staffing roles", () => {
    expect(applyResultColumnOp([], { op: "hide", id: "q9" }, QUESTIONS)).toBeNull();
    expect(applyResultColumnOp([], { op: "show", id: "member:salary" }, QUESTIONS)).toBeNull();
    expect(applyResultColumnOp([], { op: "role", id: "q1", role: "project", termId: null }, QUESTIONS)).toBeNull();
    expect(applyResultColumnOp([], { op: "statusMap", id: "q1", statusMap: {} }, QUESTIONS)).toBeNull();
  });
});
