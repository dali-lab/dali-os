import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    projectAssignment: { findMany: vi.fn() },
    jobCodeLookup: { findMany: vi.fn() },
    term: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/chart-string.server", () => ({ resolveChartStringsForTerm: vi.fn() }));

import { prisma } from "~/lib/db";
import { resolveChartStringsForTerm } from "~/lib/chart-string.server";
import { buildPayrollRows } from "~/admin/lib/payroll-export";

const db = prisma as unknown as {
  projectAssignment: { findMany: ReturnType<typeof vi.fn> };
  jobCodeLookup: { findMany: ReturnType<typeof vi.fn> };
  term: { findUnique: ReturnType<typeof vi.fn> };
};

function assignment(projectId: string) {
  return {
    projectId,
    level: "P1",
    domainId: "d1",
    user: { netId: "f00fake1", firstName: "Ada", lastName: "Lovelace" },
    project: { name: projectId },
    domain: { displayName: "Engineering" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.jobCodeLookup.findMany.mockResolvedValue([
    { level: "P1", domainId: null, jobCode: "4834", payRateUsdHour: 16.25 },
  ]);
  db.term.findUnique.mockResolvedValue({
    startDate: new Date("2026-09-14T12:00:00Z"),
    endDate: new Date("2026-11-25T12:00:00Z"),
  });
});

describe("buildPayrollRows chart strings", () => {
  it("resolves each project's string for the exported term", async () => {
    db.projectAssignment.findMany.mockResolvedValue([assignment("p1")]);
    vi.mocked(resolveChartStringsForTerm).mockResolvedValue(
      new Map([
        ["p1", { normalized: "18.722.161028.128512.3000", type: "GL", source: "project", lastOwnTermCode: null }],
      ]),
    );

    const [row] = await buildPayrollRows("t26f");

    expect(resolveChartStringsForTerm).toHaveBeenCalledWith("t26f", ["p1"]);
    expect(row.chartString).toBe("18.722.161028.128512.3000");
    expect(row.chartStringType).toBe("GL");
    expect(row.warnings).toEqual([]);
  });

  it('writes PTAEO as "PATEO", the spelling payroll has been receiving', async () => {
    db.projectAssignment.findMany.mockResolvedValue([assignment("p1")]);
    vi.mocked(resolveChartStringsForTerm).mockResolvedValue(
      new Map([
        ["p1", { normalized: "521748.5000.B04369.XXXXX.722", type: "PTAEO", source: "project", lastOwnTermCode: null }],
      ]),
    );

    const [row] = await buildPayrollRows("t26f");
    expect(row.chartStringType).toBe("PATEO");
  });

  it("warns when a project that had its own string is now inheriting", async () => {
    db.projectAssignment.findMany.mockResolvedValue([assignment("p1")]);
    vi.mocked(resolveChartStringsForTerm).mockResolvedValue(
      new Map([
        ["p1", { normalized: "20.330.161028.128512.4000", type: "GL", source: "builtIn", lastOwnTermCode: "26S" }],
      ]),
    );

    const [row] = await buildPayrollRows("t26f");
    expect(row.chartString).toBe("20.330.161028.128512.4000");
    expect(row.warnings).toEqual([
      "No chart string for this term (had its own in 26S); charging the lab default",
    ]);
  });

  it("doesn't warn a project that has always inherited the lab default", async () => {
    db.projectAssignment.findMany.mockResolvedValue([assignment("p1")]);
    vi.mocked(resolveChartStringsForTerm).mockResolvedValue(
      new Map([
        ["p1", { normalized: "20.330.161028.128512.4000", type: "GL", source: "builtIn", lastOwnTermCode: null }],
      ]),
    );

    const [row] = await buildPayrollRows("t26f");
    expect(row.warnings).toEqual([]);
  });
});
