import { describe, it, expect } from "vitest";
import { defaultStatusMap, interpretIntentForm, planIntentResync } from "../intent-form-interpreter";
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

describe("cycle-term status columns", () => {
  // The mapping entry names no term, so it follows whichever cycle the form is
  // bound to. That's what lets one intent form be re-bound each round.
  const cycleTermMapping = {
    version: 1 as const,
    entries: [
      {
        source: "question" as const,
        questionKey: "q-status",
        role: "intent-status",
        label: "Status — {{term}}",
      },
    ],
  };

  it("fills the bound cycle's own term", () => {
    const result = interpretIntentForm(
      { "q-status": "Returning" },
      cycleTermMapping,
      ["t-26f", "t-27w"],
      "t-27w",
    );
    expect(result).toEqual({ ok: true, rows: [{ termId: "t-27w", status: "Returning" }] });
  });

  it("follows the cycle when the same mapping is re-bound to the next round", () => {
    const result = interpretIntentForm(
      { "q-status": "Returning" },
      cycleTermMapping,
      ["t-26f", "t-27w", "t-27s"],
      "t-27s",
    );
    expect(result).toEqual({ ok: true, rows: [{ termId: "t-27s", status: "Returning" }] });
  });

  it("still errors when neither the entry nor the cycle names a term", () => {
    const result = interpretIntentForm(
      { "q-status": "Returning" },
      cycleTermMapping,
      ["t-26f"],
      null,
    );
    expect(result.ok).toBe(false);
  });

  it("leaves an explicitly named term alone, stale check included", () => {
    const fixed = {
      version: 1 as const,
      entries: [
        {
          source: "question" as const,
          questionKey: "q-status",
          role: "intent-status",
          label: "Status — 26F",
          termId: "t-26f",
        },
      ],
    };
    // Named term wins over the cycle's own term …
    expect(
      interpretIntentForm({ "q-status": "Off" }, fixed, ["t-26f"], "t-27w"),
    ).toEqual({ ok: true, rows: [{ termId: "t-26f", status: "Off" }] });
    // … and a term the cycle doesn't cover is still reported as stale.
    expect(
      interpretIntentForm({ "q-status": "Off" }, fixed, ["t-27w"], "t-27w").ok,
    ).toBe(false);
  });
});

describe("planIntentResync", () => {
  const mapping = m([{ source: "question", questionKey: "status", role: "intent-status", label: "Status" }]);

  it("turns every existing submission into rows for the cycle's term", () => {
    expect(
      planIntentResync(
        [
          { userId: "ada", answers: { status: "Returning" } },
          { userId: "grace", answers: { status: "Off" } },
        ],
        mapping,
        ["t27w"],
        "t27w",
      ),
    ).toEqual({
      sets: [
        { userId: "ada", rows: [{ termId: "t27w", status: "Returning" }] },
        { userId: "grace", rows: [{ termId: "t27w", status: "Off" }] },
      ],
      failed: 0,
    });
  });

  it("clears a member's rows when they left the status unanswered", () => {
    expect(planIntentResync([{ userId: "ada", answers: {} }], mapping, ["t27w"], "t27w")).toEqual({
      sets: [{ userId: "ada", rows: [] }],
      failed: 0,
    });
  });

  it("counts answers that don't fit the mapping as failed and leaves them out", () => {
    expect(
      planIntentResync(
        [
          { userId: "ada", answers: { status: "Maybe later" } },
          { userId: "grace", answers: { status: "Returning" } },
        ],
        mapping,
        ["t27w"],
        "t27w",
      ),
    ).toEqual({ sets: [{ userId: "grace", rows: [{ termId: "t27w", status: "Returning" }] }], failed: 1 });
  });

  it("treats non-object answers as unanswered", () => {
    expect(planIntentResync([{ userId: "ada", answers: null }], mapping, ["t27w"], "t27w").sets).toEqual([
      { userId: "ada", rows: [] },
    ]);
  });
});

describe("answer-to-status map", () => {
  const mapping = m([
    {
      source: "question",
      questionKey: "q",
      role: "intent-status",
      label: "Status",
      statusMap: { Yes: "Returning", No: "Off", "Maybe (D-Plan is TBD) ": "Unsure" },
    },
  ]);

  it("reads each answer through the manager's map", () => {
    for (const [answer, status] of [
      ["Yes", "Returning"],
      ["No", "Off"],
      ["Maybe (D-Plan is TBD) ", "Unsure"],
    ] as const) {
      expect(interpretIntentForm({ q: answer }, mapping, ["t"], "t")).toEqual({
        ok: true,
        rows: [{ termId: "t", status }],
      });
    }
  });

  it("matches an option despite trailing spaces on the stored answer", () => {
    expect(interpretIntentForm({ q: "Yes " }, mapping, ["t"], "t")).toMatchObject({ ok: true });
  });

  it("still accepts status names for answers outside the map", () => {
    expect(interpretIntentForm({ q: "Graduating" }, mapping, ["t"], "t")).toEqual({
      ok: true,
      rows: [{ termId: "t", status: "Graduating" }],
    });
  });

  it("rejects an answer neither the map nor the status names cover", () => {
    expect(interpretIntentForm({ q: "Perhaps" }, mapping, ["t"], "t").ok).toBe(false);
  });
});

describe("defaultStatusMap", () => {
  it("prefills options that already read as a status and leaves the rest blank", () => {
    expect(defaultStatusMap(["Returning", "Not this term", "Yes", "No"])).toEqual({
      Returning: "Returning",
      "Not this term": "Off",
    });
  });
});

describe("answer-to-status map whitespace", () => {
  it("matches an option saved with a trailing space to a trimmed answer", () => {
    const mapping = m([
      { source: "question", questionKey: "q", role: "intent-status", label: "S", statusMap: { "Maybe ": "Unsure" } },
    ]);
    expect(interpretIntentForm({ q: "Maybe" }, mapping, ["t"], "t")).toEqual({
      ok: true,
      rows: [{ termId: "t", status: "Unsure" }],
    });
  });
});
