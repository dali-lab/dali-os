import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    payPeriod: { findMany: vi.fn() },
    timesheetEntry: { findMany: vi.fn() },
    jobCodeLookup: { findMany: vi.fn() },
    projectAssignment: { findMany: vi.fn() },
    project: { findMany: vi.fn() },
    timesheetNote: { findMany: vi.fn() },
    term: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    coreAssignment: { findMany: vi.fn() },
    instructorAssignment: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/chart-string.server", () => ({
  listChartStringsByProject: vi.fn(),
  resolveChartStringsForTerm: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { listChartStringsByProject } from "~/lib/chart-string.server";
import {
  getReconciliation,
  computeExpensesByProjectChartTerm,
  buildExpectedAssignments,
} from "~/admin/lib/payroll-reconcile.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const dec = (n: number) => ({ toString: () => String(n) });

const ACTIVE_TERM = {
  startDate: new Date("2000-01-01T00:00:00Z"),
  endDate: new Date("2999-01-01T00:00:00Z"),
};
const PAST_TERM = {
  startDate: new Date("2000-01-01T00:00:00Z"),
  endDate: new Date("2000-06-01T00:00:00Z"),
};

function entry(o: Record<string, unknown> = {}) {
  return {
    employeeNetId: "f00ada",
    employeeName: "Lovelace, Ada",
    jobId: "4834",
    jobTitle: "Student Project",
    chartString: "18.722.161028.128512.3000",
    totalShiftTime: dec(10),
    hourlyPayRate: dec(16.25),
    totalEarnings: dec(162.5),
    ...o,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.payPeriod.findMany.mockResolvedValue([{ id: "pp1" }, { id: "pp2" }]);
  db.timesheetEntry.findMany.mockResolvedValue([]);
  db.jobCodeLookup.findMany.mockResolvedValue([
    { jobCode: "4834", assignmentType: "Project", level: "P1", payRateUsdHour: dec(16.25) },
  ]);
  db.projectAssignment.findMany.mockResolvedValue([]);
  db.project.findMany.mockResolvedValue([]);
  db.timesheetNote.findMany.mockResolvedValue([]);
  db.term.findUnique.mockResolvedValue(ACTIVE_TERM);
  db.user.findMany.mockResolvedValue([]);
  db.coreAssignment.findMany.mockResolvedValue([]);
  db.instructorAssignment.findMany.mockResolvedValue([]);
  vi.mocked(listChartStringsByProject).mockResolvedValue(new Map());
});

describe("getReconciliation", () => {
  it("sums a person's shifts on a job into hours and pay (Decimals become numbers)", async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      entry({ totalShiftTime: dec(10.5), totalEarnings: dec(170.63) }),
      entry({ totalShiftTime: dec(4.5), totalEarnings: dec(73.12) }),
    ]);
    db.projectAssignment.findMany.mockResolvedValue([
      { user: { netId: "F00ADA" }, project: { id: "pr1", name: "Analytical Engine" } },
    ]);
    db.project.findMany.mockResolvedValue([{ id: "pr1", name: "Analytical Engine" }]);
    db.user.findMany.mockResolvedValue([{ netId: "F00ADA", firstName: "Ada", lastName: "Lovelace" }]);

    const res = await getReconciliation("t1");

    const project = res.projects.find((p) => p.projectId === "pr1")!;
    expect(project.totalHours).toBe(15);
    expect(project.totalPay).toBeCloseTo(243.75, 2);
    expect(project.jobs).toHaveLength(1);
    expect(project.jobs[0]).toMatchObject({ netId: "f00ada", jobId: "4834", hours: 15 });
  });

  it("narrows the pay-period lookup to the requested periods within the term", async () => {
    await getReconciliation("t1", { payPeriodIds: ["pp2"] });
    expect(db.payPeriod.findMany.mock.calls[0][0].where).toEqual({ termId: "t1", id: { in: ["pp2"] } });
  });

  it("treats an empty payPeriodIds list as 'every period in the term'", async () => {
    await getReconciliation("t1", { payPeriodIds: [] });
    expect(db.payPeriod.findMany.mock.calls[0][0].where).toEqual({ termId: "t1" });
    expect(db.timesheetEntry.findMany.mock.calls[0][0].where).toEqual({
      payPeriodId: { in: ["pp1", "pp2"] },
    });
    expect(db.timesheetNote.findMany.mock.calls[0][0].where).toEqual({
      payPeriodId: { in: ["pp1", "pp2"] },
    });
  });

  it("returns an empty, shape-valid result without querying entries when the term has no pay periods", async () => {
    db.payPeriod.findMany.mockResolvedValue([]);
    const res = await getReconciliation("t1");
    expect(db.timesheetEntry.findMany).not.toHaveBeenCalled();
    expect(res.projects).toEqual([]);
    expect(res.notesByJobKey).toEqual({});
    expect(res.summary).toBeDefined();
  });

  it("drops Custom job-code lookups so a member's non-DALI job can't take part in collation", async () => {
    db.jobCodeLookup.findMany.mockResolvedValue([
      { jobCode: "9999", assignmentType: "Custom", level: null, payRateUsdHour: dec(12) },
      { jobCode: "4834", assignmentType: "Project", level: "P1", payRateUsdHour: null },
    ]);
    db.timesheetEntry.findMany.mockResolvedValue([entry({ jobId: "9999" })]);
    const res = await getReconciliation("t1");
    // 9999 has no usable lookup, so its money is External rather than a DALI project/core line.
    expect(res.external.totalPay).toBeCloseTo(162.5, 2);
    expect(res.projects).toEqual([]);
  });

  it("looks users up by the union of timesheet netIds and lowercased assignment netIds", async () => {
    db.timesheetEntry.findMany.mockResolvedValue([entry({ employeeNetId: "f00ada" })]);
    db.projectAssignment.findMany.mockResolvedValue([
      { user: { netId: "F00GRACE" }, project: { id: "pr1", name: "Compiler" } },
      { user: { netId: null }, project: { id: "pr1", name: "Compiler" } },
    ]);
    await getReconciliation("t1");
    const ids = db.user.findMany.mock.calls[0][0].where.netId.in as string[];
    expect(ids.sort()).toEqual(["f00ada", "f00grace"]);
  });

  it("attaches timesheet notes under netId::jobId", async () => {
    db.timesheetNote.findMany.mockResolvedValue([
      {
        netId: "F00ADA",
        jobId: "4834",
        note: "Forgot to clock out.",
        validatedChartstring: null,
        linkToTimesheet: null,
        payPeriod: { name: "09/14/2026 - 09/27/2026" },
      },
    ]);
    const res = await getReconciliation("t1");
    expect(res.notesByJobKey["f00ada::4834"]).toEqual([
      {
        note: "Forgot to clock out.",
        validatedChartstring: null,
        linkToTimesheet: null,
        payPeriodName: "09/14/2026 - 09/27/2026",
      },
    ]);
  });

  it("only flags pay-rate mismatches for the active term", async () => {
    const paid = entry({ hourlyPayRate: dec(20), totalEarnings: dec(200) });
    db.timesheetEntry.findMany.mockResolvedValue([paid]);
    db.user.findMany.mockResolvedValue([{ netId: "f00ada", firstName: "Ada", lastName: "Lovelace" }]);

    db.term.findUnique.mockResolvedValue(ACTIVE_TERM);
    const active = await getReconciliation("t1");
    expect(active.discrepancies.rateMismatches.map((d) => d.netId)).toEqual(["f00ada"]);

    db.term.findUnique.mockResolvedValue(PAST_TERM);
    const past = await getReconciliation("t0");
    expect(past.discrepancies.rateMismatches).toEqual([]);
  });

  it("treats a missing term as not active", async () => {
    db.term.findUnique.mockResolvedValue(null);
    db.timesheetEntry.findMany.mockResolvedValue([entry({ hourlyPayRate: dec(20) })]);
    const res = await getReconciliation("gone");
    expect(res.discrepancies.rateMismatches).toEqual([]);
  });
});

describe("computeExpensesByProjectChartTerm", () => {
  it("attributes a chart string charged to exactly one project to that project", async () => {
    db.timesheetEntry.findMany.mockResolvedValue([entry()]);
    db.project.findMany.mockResolvedValue([{ id: "pr1", name: "Analytical Engine" }]);
    vi.mocked(listChartStringsByProject).mockResolvedValue(
      new Map([["pr1", ["18.722.161028.128512.3000"]]]),
    );
    const out = await computeExpensesByProjectChartTerm("t1");
    expect(out).toEqual([
      { projectId: "pr1", chartString: expect.any(String), earnings: 162.5 },
    ]);
  });

  it("books chart strings that match no project, or several, as unassigned (projectId null)", async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      entry({ chartString: "18.722.111111.111111.1111" }),
      entry({ chartString: "18.722.222222.222222.2222" }),
    ]);
    db.project.findMany.mockResolvedValue([
      { id: "pr1", name: "A" },
      { id: "pr2", name: "B" },
    ]);
    vi.mocked(listChartStringsByProject).mockResolvedValue(
      new Map([
        ["pr1", ["18.722.222222.222222.2222"]],
        ["pr2", ["18.722.222222.222222.2222"]],
      ]),
    );
    const out = await computeExpensesByProjectChartTerm("t1");
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.projectId === null)).toBe(true);
    expect(out.reduce((s, r) => s + r.earnings, 0)).toBeCloseTo(325, 2);
  });
});

describe("buildExpectedAssignments", () => {
  it("combines project, core and instructor rows for the term's assigned users", async () => {
    // Project rows
    db.projectAssignment.findMany.mockResolvedValue([]);
    db.term.findUnique.mockResolvedValue({
      startDate: new Date("2026-09-14T12:00:00Z"),
      endDate: new Date("2026-11-25T12:00:00Z"),
    });
    db.jobCodeLookup.findMany.mockResolvedValue([
      { level: null, domainId: null, jobCode: "5000", payRateUsdHour: dec(17) },
    ]);
    db.coreAssignment.findMany.mockResolvedValue([
      { userId: "u1", leadTitle: "Director", user: { netId: "f00ada", firstName: "Ada", lastName: "Lovelace" } },
    ]);
    db.instructorAssignment.findMany.mockResolvedValue([
      { userId: "u2", user: { netId: "f00grace", firstName: "Grace", lastName: "Hopper" }, offering: { title: "Intro" } },
    ]);

    const rows = await buildExpectedAssignments("t1");

    expect(db.coreAssignment.findMany.mock.calls[0][0].where).toEqual({ termId: "t1" });
    expect(db.instructorAssignment.findMany.mock.calls[0][0].where).toEqual({ termId: "t1" });
    expect(rows.map((r) => r.netId)).toEqual(["f00ada", "f00grace"]);
    expect(rows.map((r) => r.jobId)).toEqual(["5000", "5000"]);
  });
});
