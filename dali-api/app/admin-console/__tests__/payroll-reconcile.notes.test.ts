import { describe, it, expect, vi } from "vitest";

// payroll-reconcile.server imports ~/lib/db at module load, which eagerly
// instantiates a PrismaClient the unit-test job doesn't generate. Mock it so the
// (pure) groupNotesByJobKey import resolves — same convention as the other
// server-edge tests.
vi.mock("~/lib/db");

import { groupNotesByJobKey } from "~/admin-console/lib/payroll-reconcile.server";

// Pure notes-join logic (no Prisma). Synthetic rows only — f00fake* netids and
// invented note text. Verifies the `${netId}::${jobId}` keying that the Payroll
// Data tab uses to surface notes + the count indicator.

type RawNote = Parameters<typeof groupNotesByJobKey>[0][number];

function note(o: Partial<RawNote> = {}): RawNote {
  return {
    netId: "f00fake1",
    jobId: "4834",
    note: "Adjusted a shift.",
    validatedChartstring: null,
    linkToTimesheet: null,
    payPeriod: { name: "09/14/2025 - 09/27/2025" },
    ...o,
  };
}

describe("groupNotesByJobKey", () => {
  it("keys notes by netId::jobId", () => {
    const map = groupNotesByJobKey([note()]);
    expect(Object.keys(map)).toEqual(["f00fake1::4834"]);
    expect(map["f00fake1::4834"]).toHaveLength(1);
    expect(map["f00fake1::4834"][0]).toEqual({
      note: "Adjusted a shift.",
      validatedChartstring: null,
      linkToTimesheet: null,
      payPeriodName: "09/14/2025 - 09/27/2025",
    });
  });

  it("groups multiple notes for the same (netId, jobId)", () => {
    const map = groupNotesByJobKey([
      note({ note: "First." }),
      note({ note: "Second." }),
    ]);
    expect(map["f00fake1::4834"]).toHaveLength(2);
    expect(map["f00fake1::4834"].map((n) => n.note)).toEqual(["First.", "Second."]);
  });

  it("separates notes across different jobs and people", () => {
    const map = groupNotesByJobKey([
      note({ netId: "f00fake1", jobId: "4834" }),
      note({ netId: "f00fake1", jobId: "4889" }),
      note({ netId: "f00fake2", jobId: "4834" }),
    ]);
    expect(Object.keys(map).sort()).toEqual([
      "f00fake1::4834",
      "f00fake1::4889",
      "f00fake2::4834",
    ]);
    for (const key of Object.keys(map)) expect(map[key]).toHaveLength(1);
  });

  it("lowercases the netId so it matches the lowercased timesheet entries", () => {
    const map = groupNotesByJobKey([note({ netId: "F00Fake1" })]);
    expect(map["f00fake1::4834"]).toHaveLength(1);
    expect(map["F00Fake1::4834"]).toBeUndefined();
  });

  it("preserves chart string and timesheet link when present", () => {
    const map = groupNotesByJobKey([
      note({
        validatedChartstring: "18.722.161028.128512.4000",
        linkToTimesheet: "https://timesheetx.example/ts/1",
      }),
    ]);
    const entry = map["f00fake1::4834"][0];
    expect(entry.validatedChartstring).toBe("18.722.161028.128512.4000");
    expect(entry.linkToTimesheet).toBe("https://timesheetx.example/ts/1");
  });

  it("returns an empty map for no notes", () => {
    expect(groupNotesByJobKey([])).toEqual({});
  });
});
