import { describe, it, expect } from "vitest";
import { interpretIntentForm } from "../intent-form-interpreter";
import type { ColumnMapping } from "../slot-roles";

function m(entries: ColumnMapping["entries"]): ColumnMapping {
  return { version: 1, entries };
}

describe("interpretIntentForm", () => {
  const mapping = m([
    { source: "question", questionKey: "s1", role: "intent-status", label: "T1", termId: "t1" },
    { source: "question", questionKey: "s2", role: "intent-status", label: "T2", termId: "t2" },
  ]);

  it("maps canonical enum answers per term", () => {
    const r = interpretIntentForm(
      { s1: "Returning", s2: "Graduating" },
      mapping,
      ["t1", "t2"],
    );
    expect(r).toEqual({
      ok: true,
      rows: [
        { termId: "t1", status: "Returning" },
        { termId: "t2", status: "Graduating" },
      ],
    });
  });

  it("coerces human option labels onto the enum", () => {
    const r = interpretIntentForm(
      { s1: "Not this term", s2: "On leave" },
      mapping,
      ["t1", "t2"],
    );
    expect(r).toMatchObject({
      ok: true,
      rows: [
        { termId: "t1", status: "Off" },
        { termId: "t2", status: "Leave" },
      ],
    });
  });

  it("skips unanswered terms (no row)", () => {
    const r = interpretIntentForm({ s1: "Returning", s2: "" }, mapping, [
      "t1",
      "t2",
    ]);
    expect(r).toEqual({ ok: true, rows: [{ termId: "t1", status: "Returning" }] });
  });

  it("rejects an unknown status value", () => {
    const r = interpretIntentForm({ s1: "Maybe?" }, mapping, ["t1", "t2"]);
    expect(r).toMatchObject({ ok: false });
  });

  it("rejects a term not in the cycle's term set", () => {
    const r = interpretIntentForm({ s1: "Returning" }, mapping, ["other"]);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/out of date/);
  });

  it("returns no rows (not an error) when nothing was submitted", () => {
    const r = interpretIntentForm({}, mapping, ["t1", "t2"]);
    expect(r).toEqual({ ok: true, rows: [] });
  });
});
