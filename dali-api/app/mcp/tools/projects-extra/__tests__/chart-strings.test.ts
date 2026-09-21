import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => {
  const projectChartString = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  };
  const project = { findUnique: vi.fn(), update: vi.fn() };
  return {
    prisma: {
      project,
      term: { findUnique: vi.fn() },
      projectChartString,
      // The transaction callback has to actually run: the write's whole point
      // is that the deactivate, the insert and the legacy mirror happen
      // together.
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ projectChartString, project }),
      ),
    },
  };
});
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isAdmin: vi.fn(), currentTerm: vi.fn() };
});
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db";
import { isCore, isAdmin, currentTerm } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  LIST_PROJECT_CHART_STRINGS_TOOL,
  SET_PROJECT_CHART_STRING_TOOL,
  runListProjectChartStrings,
  runSetProjectChartString,
} from "~/mcp/tools/projects-extra/chart-strings";

const db = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  term: { findUnique: ReturnType<typeof vi.fn> };
  projectChartString: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

const TERM = { code: "26F", sortKey: 20264 };

function row(over: Record<string, unknown> = {}) {
  return {
    id: "cs1",
    projectId: "p1",
    raw: "521765.5000.B04373.XXXXX.330",
    normalized: "521765.5000.B04373.XXXXX.330",
    type: "PTAEO",
    projectCode: "521765",
    subactivity: null,
    org: "330",
    awardCode: "B04373",
    fpNumber: "FP00014787",
    awardId: null,
    rapportName: null,
    awardStart: null,
    awardEnd: null,
    fundingType: "DALI_PTAEO",
    isCurrent: true,
    supersedesId: null,
    supersedeReason: null,
    note: null,
    createdAt: new Date("2026-09-19T00:00:00Z"),
    term: TERM,
    createdBy: { firstName: "Tim", lastName: "Tregubov" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isAdmin).mockResolvedValue(false);
  db.project.findUnique.mockResolvedValue({ id: "p1", name: "Link VT" });
  db.term.findUnique.mockResolvedValue({ id: "t1", code: "26F" });
  // Default: the term being written IS the current one, so the legacy mirror runs.
  vi.mocked(currentTerm).mockResolvedValue({ id: "t1" } as never);
});

describe("tool contracts", () => {
  it("reads at mcp:read and writes at mcp:admin", () => {
    // Deliberately stricter than mcp:write: a client trusted with tasks should
    // not inherit the ability to move payroll.
    expect(LIST_PROJECT_CHART_STRINGS_TOOL.requiredScope).toBe("mcp:read");
    expect(SET_PROJECT_CHART_STRING_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("requires an explicit projectId to write", () => {
    expect(SET_PROJECT_CHART_STRING_TOOL.inputSchema.required).toContain("projectId");
  });
});

describe("access", () => {
  it.each([
    ["list", () => runListProjectChartStrings("u1", { projectId: "p1" })],
    [
      "set",
      () =>
        runSetProjectChartString("u1", {
          projectId: "p1",
          termCode: "26F",
          chartString: "20.330.161028.128512.4000",
        }),
    ],
  ])("refuses %s for a non-Core, non-admin caller", async (_label, call) => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isAdmin).mockResolvedValue(false);
    await expect(call()).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("allows an admin who is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isAdmin).mockResolvedValue(true);
    db.projectChartString.findMany.mockResolvedValue([]);
    await expect(
      runListProjectChartStrings("u1", { projectId: "p1" }),
    ).resolves.toBeTruthy();
  });
});

describe("list_project_chart_strings", () => {
  it("reports an explicit row as source 'project'", async () => {
    db.projectChartString.findMany
      .mockResolvedValueOnce([row()]) // the project's own
      .mockResolvedValueOnce([]); // lab defaults
    const out = await runListProjectChartStrings("u1", { projectId: "p1" });
    expect(out.effective).toEqual([
      {
        termCode: "26F",
        source: "project",
        chartString: "521765.5000.B04373.XXXXX.330",
        type: "PTAEO",
        projectCode: "521765",
      },
    ]);
    expect(out.entries).toHaveLength(1);
  });

  it("falls back to the lab default and says so", async () => {
    // The case that matters: twenty projects hold no row of their own.
    db.projectChartString.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        row({
          id: "d1",
          projectId: null,
          normalized: "20.330.161028.128512.4000",
          type: "GL",
          projectCode: "128512",
          subactivity: "4000",
        }),
      ]);
    const out = await runListProjectChartStrings("u1", { projectId: "p1" });
    expect(out.effective[0]).toMatchObject({
      source: "labDefault",
      chartString: "20.330.161028.128512.4000",
      projectCode: "128512",
    });
    // The default is not the project's own history.
    expect(out.entries).toHaveLength(0);
  });

  it("prefers the project's own row over the default", async () => {
    db.projectChartString.findMany
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([row({ id: "d1", projectId: null, projectCode: "128512" })]);
    const out = await runListProjectChartStrings("u1", { projectId: "p1" });
    expect(out.effective[0].source).toBe("project");
    expect(out.effective[0].projectCode).toBe("521765");
  });

  it("reports 'none' when a term has neither", async () => {
    db.projectChartString.findMany.mockResolvedValue([]);
    const out = await runListProjectChartStrings("u1", {
      projectId: "p1",
      termCode: "26W",
    });
    expect(out.effective).toEqual([
      { termCode: "26W", source: "none", chartString: null, type: null, projectCode: null },
    ]);
  });

  it("excludes superseded rows unless asked", async () => {
    db.projectChartString.findMany.mockResolvedValue([]);
    await runListProjectChartStrings("u1", { projectId: "p1" });
    expect(db.projectChartString.findMany.mock.calls[0][0].where).toMatchObject({
      isCurrent: true,
    });

    vi.clearAllMocks();
    vi.mocked(isCore).mockResolvedValue(true);
    db.project.findUnique.mockResolvedValue({ id: "p1", name: "Link VT" });
    db.projectChartString.findMany.mockResolvedValue([]);
    await runListProjectChartStrings("u1", { projectId: "p1", includeSuperseded: true });
    expect(
      db.projectChartString.findMany.mock.calls[0][0].where.isCurrent,
    ).toBeUndefined();
  });

  it("404s an unknown project", async () => {
    db.project.findUnique.mockResolvedValue(null);
    await expect(
      runListProjectChartStrings("u1", { projectId: "nope" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});

describe("set_project_chart_string", () => {
  it("writes a first row with no predecessor", async () => {
    db.projectChartString.findFirst.mockResolvedValue(null);
    db.projectChartString.create.mockResolvedValue({ id: "new1", supersedesId: null });

    const out = await runSetProjectChartString("u1", {
      projectId: "p1",
      termCode: "26F",
      chartString: "523241.5000.B04662.XXXXX.330",
      fundingType: "DALI_PTAEO",
      fpNumber: "FP00014787",
    });

    expect(db.projectChartString.update).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      ok: true,
      id: "new1",
      type: "PTAEO",
      projectCode: "523241",
      supersededId: null,
      warnings: [],
    });
    const data = db.projectChartString.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      isCurrent: true,
      fundingType: "DALI_PTAEO",
      awardCode: "B04662",
      org: "330",
      supersedesId: null,
    });
    // raw is kept exactly as handed in; normalized is the derived form.
    expect(data.raw).toBe("523241.5000.B04662.XXXXX.330");
  });

  it("deactivates the previous row and points the new one at it", async () => {
    db.projectChartString.findFirst.mockResolvedValue({ id: "old1" });
    db.projectChartString.create.mockResolvedValue({ id: "new2", supersedesId: "old1" });

    const out = await runSetProjectChartString("u1", {
      projectId: "p1",
      termCode: "26F",
      chartString: "521765.5000.B04373.XXXXX.330",
      supersedeReason: "advance -> funded award",
    });

    // Deactivate first: the partial unique index allows only one current row,
    // so the old one must stop being current before the new one exists.
    expect(db.projectChartString.update).toHaveBeenCalledWith({
      where: { id: "old1" },
      data: { isCurrent: false },
    });
    expect(db.projectChartString.create.mock.calls[0][0].data).toMatchObject({
      supersedesId: "old1",
      supersedeReason: "advance -> funded award",
    });
    expect(out.supersededId).toBe("old1");
  });

  it("ignores a supersede reason when there is nothing to supersede", async () => {
    db.projectChartString.findFirst.mockResolvedValue(null);
    db.projectChartString.create.mockResolvedValue({ id: "new3", supersedesId: null });
    await runSetProjectChartString("u1", {
      projectId: "p1",
      termCode: "26F",
      chartString: "20.330.161028.128512.4000",
      supersedeReason: "nothing to replace",
    });
    expect(db.projectChartString.create.mock.calls[0][0].data.supersedeReason).toBeNull();
  });

  it("rejects a malformed string before touching the database", async () => {
    await expect(
      runSetProjectChartString("u1", {
        projectId: "p1",
        termCode: "26F",
        chartString: "tel:5226935000.B04560.xxxxx.722",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
    expect(db.projectChartString.create).not.toHaveBeenCalled();
  });

  it("rejects a truncated PTAEO", async () => {
    await expect(
      runSetProjectChartString("u1", {
        projectId: "p1",
        termCode: "26F",
        chartString: "521553.5000.B04326",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("returns warnings without blocking the write", async () => {
    db.projectChartString.findFirst.mockResolvedValue(null);
    db.projectChartString.create.mockResolvedValue({ id: "new4", supersedesId: null });
    const out = await runSetProjectChartString("u1", {
      projectId: "p1",
      termCode: "26F",
      chartString: "18.722.161028.128512.4000",
    });
    expect(out.ok).toBe(true);
    expect(out.warnings.map((w) => w.code)).toContain("org_not_current");
  });

  it("404s an unknown term", async () => {
    db.term.findUnique.mockResolvedValue(null);
    await expect(
      runSetProjectChartString("u1", {
        projectId: "p1",
        termCode: "99Z",
        chartString: "20.330.161028.128512.4000",
      }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("rejects an unparseable award date", async () => {
    await expect(
      runSetProjectChartString("u1", {
        projectId: "p1",
        termCode: "26F",
        chartString: "20.330.161028.128512.4000",
        awardStart: "not-a-date",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("audits the write", async () => {
    db.projectChartString.findFirst.mockResolvedValue(null);
    db.projectChartString.create.mockResolvedValue({ id: "new5", supersedesId: null });
    await runSetProjectChartString("u1", {
      projectId: "p1",
      termCode: "26F",
      chartString: "523244.5000.B04665.XXXXX.330",
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.chart-string.set",
        userId: "u1",
        targetId: "p1",
      }),
    );
  });
});

describe("legacy mirror (transitional)", () => {
  // Project.chartString still drives the payroll export, collation and the
  // Admin → Payroll warning. Until those readers move, a write for the current
  // term has to reach them or the string lands where nothing looks.
  it("mirrors into Project.chartString for the current term", async () => {
    db.projectChartString.findFirst.mockResolvedValue(null);
    db.projectChartString.create.mockResolvedValue({ id: "n1", supersedesId: null });

    await runSetProjectChartString("u1", {
      projectId: "p1",
      termCode: "26F",
      chartString: "523241.5000.B04662.XXXXX.330",
    });

    expect(db.project.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { chartString: "523241.5000.B04662.XXXXX.330", chartStringType: "PTAEO" },
    });
  });

  it("does NOT mirror a past or future term", async () => {
    // Project.chartString has no term, so mirroring another term's string
    // would overwrite what payroll is charging right now.
    vi.mocked(currentTerm).mockResolvedValue({ id: "some-other-term" } as never);
    db.projectChartString.findFirst.mockResolvedValue(null);
    db.projectChartString.create.mockResolvedValue({ id: "n2", supersedesId: null });

    await runSetProjectChartString("u1", {
      projectId: "p1",
      termCode: "26F",
      chartString: "523241.5000.B04662.XXXXX.330",
    });

    expect(db.project.update).not.toHaveBeenCalled();
  });
});
