import { describe, expect, it } from "vitest";
import {
  applyBoardColumnOp,
  boardTableModel,
  isBoardColumnBuiltin,
  mappingEntryProblem,
  missingRequirements,
  parseRoleChoice,
  questionRoleChoices,
  roleChoiceValue,
  showBuiltinColumn,
  validateMapping,
  type ColumnMapping,
} from "../slot-roles";
import type { ColumnOp } from "~/forms/lib/column-ops";
import type { Question } from "~/types";

const q = (key: string, label: string, extra: Partial<Question["data"]> = {}): Question =>
  ({ key, type: "select", required: false, data: { label, ...extra } }) as Question;
const QUESTIONS = [
  q("pick1", "First choice"),
  q("pick2", "Second choice"),
  q("notes", "Notes"),
  q("back", "Coming back?", { options: ["Returning", "Taking a term off", "Maybe"] }),
];

const MAPPING: ColumnMapping = {
  version: 1,
  entries: [
    { role: "submitter", label: "Person", source: "builtin", builtin: "submitter", order: 0 },
    { role: "project", label: "Project 1", source: "question", questionKey: "pick1", order: 1 },
    { role: "hiredRoles", label: "Can staff as", source: "builtin", builtin: "hiredRoles", order: 2, hidden: true },
    { role: "display", label: "Notes", source: "question", questionKey: "notes", order: 3 },
  ],
};
const TERMS = new Map([["t27w", "27W"]]);
const apply = (op: ColumnOp, mapping: ColumnMapping | null = MAPPING, slot = "project-bids" as const) =>
  applyBoardColumnOp(mapping, op, { slot, questions: QUESTIONS, termCodes: TERMS });
const intent = (op: ColumnOp, mapping: ColumnMapping | null) =>
  applyBoardColumnOp(mapping, op, { slot: "intent-to-work", questions: QUESTIONS, termCodes: TERMS });
const entriesOf = (r: ReturnType<typeof apply>) => (r.ok ? r.mapping.entries : []);
const keys = (r: ReturnType<typeof apply>) =>
  entriesOf(r).map((e) => (e.source === "builtin" ? `builtin:${e.builtin}` : `q:${e.questionKey}`));

describe("isBoardColumnBuiltin", () => {
  it("allows the member columns and nothing else", () => {
    expect(isBoardColumnBuiltin("termsInLab")).toBe(true);
    expect(isBoardColumnBuiltin("submitter")).toBe(false);
    expect(isBoardColumnBuiltin(null)).toBe(false);
  });
});

describe("showBuiltinColumn", () => {
  it("starts a mapping when the board has none", () => {
    expect(showBuiltinColumn(null, "currentRole").entries).toEqual([
      { role: "currentRole", label: "Current role", source: "builtin", builtin: "currentRole", order: 0 },
    ]);
  });
});

describe("applyBoardColumnOp show", () => {
  it("adds a question the mapping doesn't have as a display column at the end", () => {
    const r = apply({ op: "show", id: "q:pick2" });
    expect(entriesOf(r).at(-1)).toEqual({
      role: "display",
      label: "Second choice",
      source: "question",
      questionKey: "pick2",
      order: 4,
    });
  });

  it("unhides a hidden column, keeps its name and moves it to the end", () => {
    const r = apply({ op: "show", id: "builtin:hiredRoles" });
    expect(keys(r)).toEqual(["builtin:submitter", "q:pick1", "q:notes", "builtin:hiredRoles"]);
    expect(entriesOf(r).at(-1)).toMatchObject({ label: "Can staff as", hidden: false, order: 3 });
  });

  it("shows a hidden Submitted by column again", () => {
    const hidden = apply({ op: "hide", id: "builtin:submitter" });
    const r = apply({ op: "show", id: "builtin:submitter" }, hidden.ok ? hidden.mapping : null);
    expect(entriesOf(r).at(-1)).toMatchObject({ builtin: "submitter", hidden: false });
  });

  it("adds a member column", () => {
    expect(keys(apply({ op: "show", id: "builtin:termsInLab" })).at(-1)).toBe("builtin:termsInLab");
  });

  it("refuses unknown questions and builtins that aren't member columns", () => {
    expect(apply({ op: "show", id: "q:gone" })).toEqual({ ok: false, reason: "Unknown column." });
    expect(apply({ op: "show", id: "builtin:submitter" }, null)).toEqual({ ok: false, reason: "Unknown column." });
  });
});

describe("applyBoardColumnOp hide, rename, move", () => {
  it("hides in place and a hidden required column still counts as placed", () => {
    const r = apply({ op: "hide", id: "builtin:submitter" });
    expect(entriesOf(r)[0]).toMatchObject({ builtin: "submitter", hidden: true });
    expect(missingRequirements("project-bids", r.ok ? r.mapping : null)).not.toContain("Submitted by");
  });

  it("renames, and refuses an empty name", () => {
    expect(entriesOf(apply({ op: "rename", id: "q:notes", label: "Anything else" }))[3].label).toBe("Anything else");
    expect(apply({ op: "rename", id: "q:notes", label: "" })).toEqual({ ok: false, reason: "A column needs a name." });
  });

  it("moves past hidden columns and renumbers the order", () => {
    const r = apply({ op: "move", id: "q:notes", dir: -1 });
    expect(keys(r)).toEqual(["builtin:submitter", "q:notes", "builtin:hiredRoles", "q:pick1"]);
    expect(entriesOf(r).map((e) => e.order)).toEqual([0, 1, 2, 3]);
  });

  it("refuses a column the mapping doesn't have", () => {
    expect(apply({ op: "hide", id: "q:pick2" })).toEqual({ ok: false, reason: "Unknown column." });
  });
});

describe("applyBoardColumnOp role", () => {
  it("makes a display column feed a repeatable role, numbered after the others", () => {
    const r = apply({ op: "role", id: "q:notes", role: "project", termId: null });
    expect(entriesOf(r)[3]).toEqual({ role: "project", label: "Project 2", source: "question", questionKey: "notes", order: 3 });
  });

  it("back to display takes the question's name and drops term and status answers", () => {
    const mapping: ColumnMapping = {
      version: 1,
      entries: [
        { role: "intent-status", label: "Status — 27W", source: "question", questionKey: "back", termId: "t27w", order: 0, statusMap: { Maybe: "Off" } },
      ],
    };
    const r = intent({ op: "role", id: "q:back@t27w", role: "display", termId: null }, mapping);
    expect(entriesOf(r)).toEqual([{ role: "display", label: "Coming back?", source: "question", questionKey: "back", order: 0 }]);
  });

  it("a per-term role names the term and fills status answers from the options", () => {
    const mapping: ColumnMapping = {
      version: 1,
      entries: [{ role: "display", label: "Coming back?", source: "question", questionKey: "back", order: 0 }],
    };
    const r = intent({ op: "role", id: "q:back", role: "intent-status", termId: "t27w" }, mapping);
    expect(entriesOf(r)[0]).toMatchObject({
      role: "intent-status",
      label: "Status — 27W",
      termId: "t27w",
      statusMap: { Returning: "Returning" },
    });
    const cycleTerm = intent({ op: "role", id: "q:back", role: "intent-status", termId: null }, mapping);
    expect(entriesOf(cycleTerm)[0]).toMatchObject({ label: "Status — {{term}}" });
    expect(entriesOf(cycleTerm)[0].termId).toBeUndefined();
  });

  it("keeps status answers when the term changes", () => {
    const mapping: ColumnMapping = {
      version: 1,
      entries: [
        { role: "intent-status", label: "Status — {{term}}", source: "question", questionKey: "back", order: 0, statusMap: { Maybe: "Off" } },
      ],
    };
    const r = intent({ op: "role", id: "q:back", role: "intent-status", termId: "t27w" }, mapping);
    expect(entriesOf(r)[0].statusMap).toEqual({ Maybe: "Off" });
  });

  it("refuses two status columns for the same term", () => {
    const mapping: ColumnMapping = {
      version: 1,
      entries: [
        { role: "intent-status", label: "Status — 27W", source: "question", questionKey: "back", termId: "t27w", order: 0 },
        { role: "display", label: "Notes", source: "question", questionKey: "notes", order: 1 },
      ],
    };
    const r = intent({ op: "role", id: "q:notes", role: "intent-status", termId: "t27w" }, mapping);
    expect(r).toEqual({ ok: false, reason: 'The "Status" column is mapped more than once for the same term.' });
  });

  it("refuses roles the slot doesn't have, terms on a role without terms, unknown terms and builtin columns", () => {
    expect(apply({ op: "role", id: "q:notes", role: "intent-status", termId: null })).toEqual({ ok: false, reason: "Unknown staffing role." });
    expect(apply({ op: "role", id: "q:notes", role: "submitter", termId: null })).toEqual({ ok: false, reason: "Unknown staffing role." });
    expect(apply({ op: "role", id: "q:notes", role: "project", termId: "t27w" })).toEqual({ ok: false, reason: "Unknown staffing role." });
    expect(intent({ op: "role", id: "q:notes", role: "intent-status", termId: "t1" }, {
      version: 1,
      entries: [{ role: "display", label: "Notes", source: "question", questionKey: "notes", order: 0 }],
    })).toEqual({ ok: false, reason: "Unknown term." });
    expect(apply({ op: "role", id: "builtin:submitter", role: "display", termId: null })).toEqual({
      ok: false,
      reason: "Only a question column can feed staffing.",
    });
  });
});

describe("applyBoardColumnOp on a mapping that's already stale", () => {
  it("still allows column edits while the stale entry stays the same problem", () => {
    const stale: ColumnMapping = {
      version: 1,
      entries: [
        { role: "display", label: "Old", source: "question", questionKey: "removed", order: 0 },
        { role: "display", label: "Notes", source: "question", questionKey: "notes", order: 1 },
      ],
    };
    expect(apply({ op: "rename", id: "q:notes", label: "More" }, stale).ok).toBe(true);
  });
});

describe("mappingEntryProblem", () => {
  it("ignores missing required roles that validateMapping reports", () => {
    expect(mappingEntryProblem("project-bids", QUESTIONS, MAPPING)).toBeNull();
    expect(validateMapping("project-bids", QUESTIONS, MAPPING).ok).toBe(false);
  });
});

describe("role choices", () => {
  it("offers display and each question role, per term for per-term roles", () => {
    expect(questionRoleChoices("project-bids", [])).toEqual([
      { value: "display", label: "Nothing, just show it" },
      { value: "project", label: "Project" },
    ]);
    expect(questionRoleChoices("intent-to-work", [{ id: "t27w", code: "27W" }]).map((c) => c.value)).toEqual([
      "display",
      "intent-status@",
      "intent-status@t27w",
    ]);
  });

  it("round-trips a column's choice", () => {
    expect(roleChoiceValue({ role: "intent-status", termId: "t27w" }, "intent-to-work")).toBe("intent-status@t27w");
    expect(roleChoiceValue({ role: "intent-status" }, "intent-to-work")).toBe("intent-status@");
    expect(roleChoiceValue({ role: "project" }, "project-bids")).toBe("project");
    expect(parseRoleChoice("intent-status@t27w")).toEqual({ role: "intent-status", termId: "t27w" });
    expect(parseRoleChoice("intent-status@")).toEqual({ role: "intent-status", termId: null });
    expect(parseRoleChoice("display")).toEqual({ role: "display", termId: null });
  });
});

describe("boardTableModel", () => {
  it("tags question columns with their role and lists what + can add", () => {
    const m = boardTableModel(
      "project-bids",
      MAPPING,
      [
        { key: "builtin:submitter", label: "Person", source: "builtin", role: "submitter" },
        { key: "q:pick1", label: "Project 1", source: "question", role: "project" },
      ],
      QUESTIONS.map((x) => ({ key: x.key, label: x.data.label })),
      [],
    );
    expect(m.columns).toEqual([
      { key: "builtin:submitter", label: "Person" },
      { key: "q:pick1", label: "Project 1", role: "project" },
    ]);
    expect(m.addable).toEqual([
      { key: "builtin:hiredRoles", label: "Can staff as" },
      { key: "q:pick2", label: "Second choice" },
      { key: "q:back", label: "Coming back?" },
      { key: "builtin:projectHistory", label: "Project history" },
      { key: "builtin:termsInLab", label: "Terms in lab" },
      { key: "builtin:currentRole", label: "Current role" },
    ]);
    expect(m.roleChoices.map((c) => c.value)).toEqual(["display", "project"]);
  });
});
