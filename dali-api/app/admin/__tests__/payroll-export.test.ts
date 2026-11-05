import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    projectAssignment: { findMany: vi.fn() },
    coreAssignment: { findMany: vi.fn() },
    instructorAssignment: { findMany: vi.fn() },
    jobCodeLookup: { findMany: vi.fn() },
    term: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/chart-string.server", () => ({ resolveChartStringsForTerm: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { resolveChartStringsForTerm } from "~/lib/chart-string.server";
import {
  ANTICIPATED_HOURS_PER_WEEK,
  CORE_INSTRUCTOR_CHART_STRING,
  CSV_HEADERS,
  PRIMARY_SUPERVISOR_NETID,
  SECONDARY_SUPERVISOR_NETID,
  buildCoreRows,
  buildInstructorRows,
  buildPayrollRows,
  formatDate,
  listCoreCandidates,
  listInstructorCandidates,
  listTermDomains,
  pickDefaultTermId,
  resolveJobCode,
  rowsToCsv,
  type PayrollRow,
} from "~/admin/lib/payroll-export";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const TERM = {
  startDate: new Date("2026-09-14T00:00:00Z"),
  endDate: new Date("2026-11-25T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  db.term.findUnique.mockResolvedValue(TERM);
});

describe("formatDate", () => {
  it("writes MMDDYY with no separators", () => {
    expect(formatDate(new Date("2026-09-04T00:00:00Z"))).toBe("090426");
  });

  it("uses the UTC calendar day so a midnight-UTC term boundary never shifts a day", () => {
    expect(formatDate(new Date("2026-01-01T00:00:00Z"))).toBe("010126");
    expect(formatDate(new Date("2026-12-31T23:59:59Z"))).toBe("123126");
  });
});

describe("resolveJobCode", () => {
  const wage = (n: number) => ({ toString: () => String(n) });
  const lookups = [
    { level: null, domainId: null, jobCode: "WILD", payRateUsdHour: wage(10) },
    { level: "P1", domainId: null, jobCode: "LEVEL", payRateUsdHour: wage(11) },
    { level: null, domainId: "d1", jobCode: "DOMAIN", payRateUsdHour: wage(12) },
    { level: "P1", domainId: "d1", jobCode: "EXACT", payRateUsdHour: wage(13) },
  ];

  it("prefers the exact (level, domain) match", () => {
    expect(resolveJobCode(lookups, "P1", "d1")).toEqual({ jobCode: "EXACT", hourlyWage: "13" });
  });

  it("falls back level-only, then domain-only, then wildcard", () => {
    expect(resolveJobCode(lookups, "P1", "d2")?.jobCode).toBe("LEVEL");
    expect(resolveJobCode(lookups, "P2", "d1")?.jobCode).toBe("DOMAIN");
    expect(resolveJobCode(lookups, "P2", "d2")?.jobCode).toBe("WILD");
  });

  it("ranks level-only above domain-only when both match", () => {
    const only = lookups.filter((l) => l.jobCode === "LEVEL" || l.jobCode === "DOMAIN");
    expect(resolveJobCode(only, "P1", "d1")?.jobCode).toBe("LEVEL");
  });

  it("returns null when nothing matches", () => {
    expect(resolveJobCode([lookups[3]], "P2", "d1")).toBeNull();
    expect(resolveJobCode([], "P1", "d1")).toBeNull();
  });

  it("returns a blank wage for a job code with no pay rate", () => {
    expect(
      resolveJobCode([{ level: null, domainId: null, jobCode: "X", payRateUsdHour: null }], "P1", "d1"),
    ).toEqual({ jobCode: "X", hourlyWage: "" });
  });
});

describe("pickDefaultTermId", () => {
  const terms = [
    { id: "future", startDate: new Date("2027-01-01"), endDate: new Date("2027-03-01") },
    { id: "current", startDate: new Date("2026-09-01"), endDate: new Date("2026-12-01") },
    { id: "past", startDate: new Date("2026-01-01"), endDate: new Date("2026-03-01") },
  ];

  it("picks the term containing now", () => {
    expect(pickDefaultTermId(terms, new Date("2026-10-01"))).toBe("current");
  });

  it("includes both boundary instants", () => {
    expect(pickDefaultTermId(terms, new Date("2026-09-01"))).toBe("current");
    expect(pickDefaultTermId(terms, new Date("2026-12-01"))).toBe("current");
  });

  it("falls back to the first (most recent) term when none contains now", () => {
    expect(pickDefaultTermId(terms, new Date("2026-06-01"))).toBe("future");
  });

  it("returns null with no terms", () => {
    expect(pickDefaultTermId([])).toBeNull();
  });
});

describe("listTermDomains", () => {
  it("returns each domain once, sorted by display name", async () => {
    db.projectAssignment.findMany.mockResolvedValue([
      { domain: { id: "d2", displayName: "Product" } },
      { domain: { id: "d1", displayName: "Engineering" } },
    ]);
    expect(await listTermDomains("t1")).toEqual([
      { id: "d1", displayName: "Engineering" },
      { id: "d2", displayName: "Product" },
    ]);
    expect(db.projectAssignment.findMany.mock.calls[0][0]).toMatchObject({
      where: { termId: "t1" },
      distinct: ["domainId"],
    });
  });
});

describe("listCoreCandidates", () => {
  it("merges several Core titles into one candidate per user, sorted by name", async () => {
    db.coreAssignment.findMany.mockResolvedValue([
      { userId: "u2", leadTitle: "Director", user: { netId: "f00grace", firstName: "Grace", lastName: "Hopper" } },
      { userId: "u1", leadTitle: "Treasurer", user: { netId: "f00ada", firstName: "Ada", lastName: "Lovelace" } },
      { userId: "u1", leadTitle: "Secretary", user: { netId: "f00ada", firstName: "Ada", lastName: "Lovelace" } },
      { userId: "u1", leadTitle: null, user: { netId: "f00ada", firstName: "Ada", lastName: "Lovelace" } },
    ]);
    const out = await listCoreCandidates("t1");
    expect(out.map((c) => [c.userId, c.subtitle])).toEqual([
      ["u2", "Director"],
      ["u1", "Treasurer, Secretary"],
    ]);
    expect(db.coreAssignment.findMany.mock.calls[0][0].where).toEqual({ termId: "t1" });
  });
});

describe("listInstructorCandidates", () => {
  it("merges several offerings into one candidate per user", async () => {
    db.instructorAssignment.findMany.mockResolvedValue([
      { userId: "u1", user: { netId: "f00ada", firstName: "Ada", lastName: "Lovelace" }, offering: { title: "Intro" } },
      { userId: "u1", user: { netId: "f00ada", firstName: "Ada", lastName: "Lovelace" }, offering: { title: "Advanced" } },
    ]);
    const out = await listInstructorCandidates("t1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ userId: "u1", subtitle: "Intro, Advanced" });
  });
});

describe("buildCoreRows / buildInstructorRows", () => {
  const coreRow = (userId: string, netId: string | null, lastName: string) => ({
    userId,
    leadTitle: "Director",
    user: { netId, firstName: "Ada", lastName },
  });

  it("returns [] without touching the DB lookups when nothing is selected", async () => {
    db.coreAssignment.findMany.mockResolvedValue([coreRow("u1", "f00ada", "Lovelace")]);
    expect(await buildCoreRows("t1", new Set())).toEqual([]);
    expect(db.jobCodeLookup.findMany).not.toHaveBeenCalled();
  });

  it("builds a Core row from the wildcard job code, the term dates and the lab chart string", async () => {
    db.coreAssignment.findMany.mockResolvedValue([
      coreRow("u1", "f00ada", "Lovelace"),
      coreRow("u2", "f00grace", "Hopper"),
    ]);
    db.jobCodeLookup.findMany.mockResolvedValue([
      { level: null, domainId: null, jobCode: "8001", payRateUsdHour: { toString: () => "18" } },
    ]);

    const rows = await buildCoreRows("t1", new Set(["u1"]));

    expect(db.jobCodeLookup.findMany.mock.calls[0][0].where).toEqual({ assignmentType: "Core" });
    expect(rows).toEqual([
      {
        netId: "f00ada",
        firstName: "Ada",
        lastName: "Lovelace",
        jobId: "8001",
        hourlyWage: "18",
        hireStart: "091426",
        hireEnd: "112526",
        chartStringType: "",
        chartString: CORE_INSTRUCTOR_CHART_STRING,
        domain: "",
        level: "",
        warnings: [],
      },
    ]);
  });

  it("warns on a missing job code lookup and a missing NetID", async () => {
    db.coreAssignment.findMany.mockResolvedValue([coreRow("u1", null, "Lovelace")]);
    db.jobCodeLookup.findMany.mockResolvedValue([]);
    const [row] = await buildCoreRows("t1", new Set(["u1"]));
    expect(row.warnings).toEqual(["No JobCodeLookup for Core", "User missing NetID"]);
    expect(row.jobId).toBe("");
    expect(row.hourlyWage).toBe("");
    expect(row.netId).toBe("");
  });

  it("returns no rows when the term does not exist", async () => {
    db.coreAssignment.findMany.mockResolvedValue([coreRow("u1", "f00ada", "Lovelace")]);
    db.jobCodeLookup.findMany.mockResolvedValue([]);
    db.term.findUnique.mockResolvedValue(null);
    expect(await buildCoreRows("t1", new Set(["u1"]))).toEqual([]);
  });

  it("looks up Instructor job codes for instructor rows", async () => {
    db.instructorAssignment.findMany.mockResolvedValue([
      { userId: "u1", user: { netId: "f00ada", firstName: "Ada", lastName: "Lovelace" }, offering: { title: "Intro" } },
    ]);
    db.jobCodeLookup.findMany.mockResolvedValue([
      { level: null, domainId: null, jobCode: "8100", payRateUsdHour: { toString: () => "25" } },
    ]);
    const [row] = await buildInstructorRows("t1", new Set(["u1"]));
    expect(db.jobCodeLookup.findMany.mock.calls[0][0].where).toEqual({ assignmentType: "Instructor" });
    expect(row).toMatchObject({ jobId: "8100", hourlyWage: "25", warnings: [] });
  });
});

describe("buildPayrollRows", () => {
  const assignment = (o: Record<string, unknown> = {}) => ({
    projectId: "p1",
    level: "P1",
    domainId: "d1",
    user: { netId: "f00ada", firstName: "Ada", lastName: "Lovelace" },
    project: { name: "Analytical Engine" },
    domain: { displayName: "Engineering" },
    ...o,
  });
  const cs = {
    normalized: "18.722.161028.128512.3000",
    type: "GL",
    source: "project",
    lastOwnTermCode: null,
  } as const;

  beforeEach(() => {
    db.jobCodeLookup.findMany.mockResolvedValue([
      { level: "P1", domainId: null, jobCode: "4834", payRateUsdHour: { toString: () => "16.25" } },
    ]);
    vi.mocked(resolveChartStringsForTerm).mockResolvedValue(new Map([["p1", cs]]));
  });

  it("emits a full row: person, job code and wage by level, term dates, chart string, domain", async () => {
    db.projectAssignment.findMany.mockResolvedValue([assignment()]);
    const rows = await buildPayrollRows("t1", { domainIds: ["d1"] });
    expect(db.projectAssignment.findMany.mock.calls[0][0].where).toEqual({
      termId: "t1",
      domainId: { in: ["d1"] },
    });
    expect(rows).toEqual([
      {
        netId: "f00ada",
        firstName: "Ada",
        lastName: "Lovelace",
        jobId: "4834",
        hourlyWage: "16.25",
        hireStart: "091426",
        hireEnd: "112526",
        chartStringType: "GL",
        chartString: "18.722.161028.128512.3000",
        domain: "Engineering",
        level: "P1",
        warnings: [],
      },
    ]);
  });

  it("warns when no job code matches the level, and when the NetID is missing", async () => {
    db.projectAssignment.findMany.mockResolvedValue([
      assignment({ level: "P3", user: { netId: null, firstName: "Grace", lastName: "Hopper" } }),
    ]);
    const [row] = await buildPayrollRows("t1");
    expect(row.warnings).toEqual(["No JobCodeLookup for level=P3", "User missing NetID"]);
    expect(row.netId).toBe("");
    expect(row.jobId).toBe("");
  });

  it("returns no rows when the term does not exist", async () => {
    db.projectAssignment.findMany.mockResolvedValue([assignment()]);
    db.term.findUnique.mockResolvedValue(null);
    expect(await buildPayrollRows("t1")).toEqual([]);
    expect(resolveChartStringsForTerm).not.toHaveBeenCalled();
  });
});

describe("rowsToCsv", () => {
  const row: PayrollRow = {
    netId: "f00ada",
    firstName: "Ada",
    lastName: "Lovelace, Countess",
    jobId: "4834",
    hourlyWage: "16.25",
    hireStart: "091426",
    hireEnd: "112526",
    chartStringType: "GL",
    chartString: "18.722.161028.128512.3000",
    domain: "Engineering",
    level: "P1",
    warnings: ["ignored"],
  };

  it("writes the 16 payroll headers first, in order", () => {
    const [header] = rowsToCsv([]).split(/\r?\n/);
    expect(header.split(",")).toEqual([...CSV_HEADERS]);
    expect(CSV_HEADERS).toHaveLength(16);
  });

  it("fills supervisors and anticipated hours with the lab constants and leaves the last four columns blank", () => {
    const [, line] = rowsToCsv([row]).trim().split(/\r?\n/);
    expect(line).toBe(
      [
        "f00ada",
        "Ada",
        '"Lovelace, Countess"',
        "4834",
        PRIMARY_SUPERVISOR_NETID,
        SECONDARY_SUPERVISOR_NETID,
        "16.25",
        ANTICIPATED_HOURS_PER_WEEK,
        "091426",
        "112526",
        "GL",
        "18.722.161028.128512.3000",
        "",
        "",
        "",
        "",
      ].join(","),
    );
  });

  it("does not leak the preview-only domain, level or warnings into the CSV", () => {
    const csv = rowsToCsv([row]);
    expect(csv).not.toContain("Engineering");
    expect(csv).not.toContain("ignored");
  });
});
