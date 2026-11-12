import { describe, expect, it } from "vitest";
import {
  hideBuiltinColumn,
  isBoardColumnBuiltin,
  missingRequirements,
  showBuiltinColumn,
  type ColumnMapping,
} from "../slot-roles";

const MAPPING: ColumnMapping = {
  version: 1,
  entries: [
    { role: "submitter", label: "Person", source: "builtin", builtin: "submitter", order: 0 },
    { role: "hiredRoles", label: "Can staff as", source: "builtin", builtin: "hiredRoles", order: 1, hidden: true },
    { role: "display", label: "Notes", source: "question", questionKey: "q1", order: 4 },
  ],
};

describe("isBoardColumnBuiltin", () => {
  it("allows the member columns and nothing else", () => {
    expect(isBoardColumnBuiltin("termsInLab")).toBe(true);
    expect(isBoardColumnBuiltin("submitter")).toBe(false);
    expect(isBoardColumnBuiltin("q1")).toBe(false);
    expect(isBoardColumnBuiltin(null)).toBe(false);
  });
});

describe("showBuiltinColumn", () => {
  it("appends a new column after the last one with its default label", () => {
    const next = showBuiltinColumn(MAPPING, "termsInLab");
    expect(next.entries.slice(0, 3)).toEqual(MAPPING.entries);
    expect(next.entries[3]).toEqual({
      role: "termsInLab",
      label: "Terms in lab",
      source: "builtin",
      builtin: "termsInLab",
      order: 5,
    });
  });

  it("unhides a column the mapping already has, keeps its label and moves it to the end", () => {
    const next = showBuiltinColumn(MAPPING, "hiredRoles");
    expect(next.entries).toHaveLength(3);
    expect(next.entries[1]).toMatchObject({ label: "Can staff as", hidden: false, order: 5 });
  });

  it("starts a mapping when the board has none", () => {
    expect(showBuiltinColumn(null, "currentRole").entries).toEqual([
      { role: "currentRole", label: "Current role", source: "builtin", builtin: "currentRole", order: 0 },
    ]);
  });
});

describe("hideBuiltinColumn", () => {
  it("hides the column and leaves every other entry alone", () => {
    const shown = showBuiltinColumn(MAPPING, "hiredRoles");
    const next = hideBuiltinColumn(shown, "hiredRoles");
    expect(next.entries[1]).toMatchObject({ builtin: "hiredRoles", hidden: true });
    expect(next.entries[0]).toEqual(MAPPING.entries[0]);
    expect(next.entries[2]).toEqual(MAPPING.entries[2]);
  });

  it("still counts a hidden required column as placed", () => {
    const next = hideBuiltinColumn(MAPPING, "hiredRoles");
    expect(missingRequirements("project-bids", next)).not.toContain("Hired roles");
  });
});
