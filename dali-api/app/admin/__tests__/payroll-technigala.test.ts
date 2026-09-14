import { describe, it, expect, beforeEach, vi } from "vitest";

// Self-contained db mock: buildTechnigalaRows only touches technigalaAssignment
// + term, so stub just those rather than the whole shared client.
vi.mock("~/lib/db", () => ({
  prisma: {
    technigalaAssignment: { findMany: vi.fn() },
    term: { findUnique: vi.fn() },
  },
}));

import { prisma } from "~/lib/db";
import {
  buildTechnigalaRows,
  listTechnigalaCandidates,
  TECHNIGALA_JOB_CODE,
  TECHNIGALA_WAGE,
  TECHNIGALA_CHART_STRING,
  TECHNIGALA_CHART_STRING_TYPE,
} from "~/admin/lib/payroll-export";

const mockPrisma = prisma as unknown as {
  technigalaAssignment: { findMany: ReturnType<typeof vi.fn> };
  term: { findUnique: ReturnType<typeof vi.fn> };
};

const HIRES = [
  { userId: "u1", user: { netId: "f00abc1", firstName: "Ada", lastName: "Lovelace" } },
  { userId: "u2", user: { netId: null, firstName: "Alan", lastName: "Turing" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.term.findUnique.mockResolvedValue({
    startDate: new Date("2026-09-14T00:00:00Z"),
    endDate: new Date("2026-11-24T00:00:00Z"),
  });
  mockPrisma.technigalaAssignment.findMany.mockResolvedValue(HIRES);
});

describe("listTechnigalaCandidates", () => {
  it("maps hires to candidates, sorted by name, tagged Technigala", async () => {
    const rows = await listTechnigalaCandidates("term_1");
    expect(rows).toEqual([
      { userId: "u1", netId: "f00abc1", firstName: "Ada", lastName: "Lovelace", subtitle: "Technigala" },
      { userId: "u2", netId: null, firstName: "Alan", lastName: "Turing", subtitle: "Technigala" },
    ]);
  });
});

describe("buildTechnigalaRows", () => {
  it("returns [] and hits no DB when nothing is selected", async () => {
    const rows = await buildTechnigalaRows("term_1", new Set());
    expect(rows).toEqual([]);
    expect(mockPrisma.technigalaAssignment.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.term.findUnique).not.toHaveBeenCalled();
  });

  it("emits the fixed 8274 code / $19 wage / lab chart string for a selected hire", async () => {
    const rows = await buildTechnigalaRows("term_1", new Set(["u1"]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      netId: "f00abc1",
      firstName: "Ada",
      lastName: "Lovelace",
      jobId: TECHNIGALA_JOB_CODE,
      hourlyWage: TECHNIGALA_WAGE,
      chartString: TECHNIGALA_CHART_STRING,
      chartStringType: TECHNIGALA_CHART_STRING_TYPE,
      domain: "",
      level: "",
      warnings: [],
    });
    expect(rows[0].jobId).toBe("8274");
    expect(rows[0].hourlyWage).toBe("19");
  });

  it("includes only selected hires and flags a missing NetID", async () => {
    const rows = await buildTechnigalaRows("term_1", new Set(["u1", "u2"]));
    expect(rows.map((r) => `${r.firstName} ${r.lastName}`)).toEqual([
      "Ada Lovelace",
      "Alan Turing",
    ]);
    const turing = rows.find((r) => r.lastName === "Turing")!;
    expect(turing.netId).toBe("");
    expect(turing.warnings).toContain("User missing NetID");
  });

  it("drops selected ids that aren't Technigala hires", async () => {
    const rows = await buildTechnigalaRows("term_1", new Set(["nobody"]));
    expect(rows).toEqual([]);
  });
});
