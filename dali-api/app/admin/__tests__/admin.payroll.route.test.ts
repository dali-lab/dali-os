import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn((_req: Request) =>
    Response.json({ error: "Forbidden" }, { status: 403 }),
  ),
}));
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn() }));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
vi.mock("~/admin/lib/payroll-reconcile.server", () => ({
  getReconciliation: vi.fn(),
}));
vi.mock("~/lib/chart-string.server", () => {
  class ChartStringValidationError extends Error {
    status = 400;
  }
  return {
    resolveChartStringsForTerm: vi.fn(),
    recordProjectChartString: vi.fn(),
    ChartStringValidationError,
  };
});

import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import { getReconciliation } from "~/admin/lib/payroll-reconcile.server";
import {
  ChartStringValidationError,
  recordProjectChartString,
  resolveChartStringsForTerm,
} from "~/lib/chart-string.server";
import { prisma } from "~/lib/db.server";
import { loader as pageLoader, action as pageAction } from "~/admin/routes/admin.payroll";
import { loader as csvLoader } from "~/admin/routes/admin.payroll.csv";

const ADMIN_ID = "admin-1";

const EMPTY_RECONCILIATION = {
  projects: [],
  core: { category: "Core", totalHours: 0, totalPay: 0, jobs: [] },
  instructor: { category: "Instructor", totalHours: 0, totalPay: 0, jobs: [] },
  external: { category: "External", totalHours: 0, totalPay: 0, jobs: [] },
  chartStrings: [],
  discrepancies: {
    assignedNoHours: [],
    unassignedJobs: [],
    rateMismatches: [],
    unknownPersons: [],
  },
  summary: {
    daliHours: 0,
    daliPay: 0,
    externalHours: 0,
    externalPay: 0,
    totalHours: 0,
    totalPay: 0,
    daliStudentCount: 0,
    medianPay: 0,
  },
  notesByJobKey: {},
};

function asAdmin() {
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: ADMIN_ID, email: "a@x.com", type: "user" },
  } as any);
  vi.mocked(isAdmin).mockResolvedValue(true);
}
function asNonAdmin() {
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "rando-1", email: "r@x.com", type: "user" },
  } as any);
  vi.mocked(isAdmin).mockResolvedValue(false);
}
function asAnon() {
  vi.mocked(requireAuth).mockResolvedValue({
    ok: false,
    response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    reason: "no_session",
  } as any);
}

function req(url: string) {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTermFilter).mockResolvedValue({
    terms: [{ id: "term-25f", code: "25F" }],
    selected: "term-25f",
    termId: "term-25f",
    isAll: false,
  } as any);
  vi.mocked(getReconciliation).mockResolvedValue(EMPTY_RECONCILIATION as any);
  (prisma as any).payPeriod = { findMany: vi.fn().mockResolvedValue([]) };
  (prisma as any).project.findMany = vi.fn().mockResolvedValue([]);
  vi.mocked(resolveChartStringsForTerm).mockResolvedValue(new Map());
});

describe("payroll page loader — auth gate", () => {
  it("redirects anonymous users to /login", async () => {
    asAnon();
    const res = (await pageLoader({
      request: req("http://localhost/admin/payroll/reconcile"),
      params: {},
      context: {},
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `/login?next=${encodeURIComponent("/admin/payroll/reconcile")}`,
    );
    expect(getReconciliation).not.toHaveBeenCalled();
  });

  it("redirects non-admins to /admin/members", async () => {
    asNonAdmin();
    const res = (await pageLoader({
      request: req("http://localhost/admin/payroll/reconcile"),
      params: {},
      context: {},
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/members");
    expect(getReconciliation).not.toHaveBeenCalled();
  });

  it("loads reconciliation for an admin", async () => {
    asAdmin();
    const data = await pageLoader({
      request: req("http://localhost/admin/payroll/reconcile?term=term-25f"),
      params: {},
      context: {},
    } as any);
    expect(getReconciliation).toHaveBeenCalledWith("term-25f");
    expect((data as any).reconciliation).toEqual(EMPTY_RECONCILIATION);
  });

  it("flags only staffed projects that had their own chart string before and not this term", async () => {
    asAdmin();
    vi.mocked(prisma.project.findMany).mockResolvedValueOnce([
      { id: "p-lab", name: "Lab GL project" },
      { id: "p-own", name: "Has its own" },
      { id: "p-lapsed", name: "zebraMD" },
    ] as never);
    vi.mocked(resolveChartStringsForTerm).mockResolvedValueOnce(
      new Map([
        // Always on the lab GL — inheriting is correct, no banner.
        ["p-lab", { normalized: "20.330.161028.128512.4000", type: "GL", source: "builtIn", lastOwnTermCode: null }],
        ["p-own", { normalized: "18.722.161028.128512.3000", type: "GL", source: "project", lastOwnTermCode: null }],
        // Sponsored last term, nobody re-entered it.
        ["p-lapsed", { normalized: "20.330.161028.128512.4000", type: "GL", source: "builtIn", lastOwnTermCode: "26S" }],
      ]),
    );
    const data = await pageLoader({
      request: req("http://localhost/admin/payroll/reconcile?term=term-25f"),
      params: {},
      context: {},
    } as any);
    expect((data as any).missingChartStrings).toEqual([
      { projectId: "p-lapsed", name: "zebraMD", lastOwnTermCode: "26S" },
    ]);
    expect((data as any).projectChartStrings).toEqual({
      "p-lab": { chartString: "20.330.161028.128512.4000", source: "builtIn" },
      "p-own": { chartString: "18.722.161028.128512.3000", source: "project" },
      "p-lapsed": { chartString: "20.330.161028.128512.4000", source: "builtIn" },
    });
  });

  it("returns empty chart-string data when no term is selected", async () => {
    asAdmin();
    vi.mocked(resolveTermFilter).mockResolvedValueOnce({
      terms: [],
      selected: "all",
      termId: null,
      isAll: true,
    } as any);
    const data = await pageLoader({
      request: req("http://localhost/admin/payroll/reconcile?term=all"),
      params: {},
      context: {},
    } as any);
    expect((data as any).missingChartStrings).toEqual([]);
    expect((data as any).projectChartStrings).toEqual({});
    expect(getReconciliation).not.toHaveBeenCalled();
  });
});

function postForm(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("http://localhost/admin/payroll/reconcile", { method: "POST", body });
}

const VALID = {
  intent: "set-chart-string",
  projectId: "p-lapsed",
  termId: "term-25f",
  chartString: "18.722.161028.128512.3000",
};

describe("payroll page action — set-chart-string", () => {
  beforeEach(() => {
    (prisma as any).project.findFirst = vi.fn().mockResolvedValue({ id: "p-lapsed" });
    vi.mocked(recordProjectChartString).mockResolvedValue({
      id: "pcs-1",
      supersededId: null,
      normalized: "18.722.161028.128512.3000",
      type: "GL",
      projectCode: "161028",
      warnings: [{ code: "org", message: "Unexpected org." }],
    } as any);
  });

  const run = (fields: Record<string, string>) =>
    pageAction({ request: postForm(fields), params: {}, context: {} } as any) as Promise<Response>;

  it("redirects anonymous users to /login", async () => {
    asAnon();
    const res = await run(VALID);
    expect(res.status).toBe(302);
    expect(recordProjectChartString).not.toHaveBeenCalled();
  });

  it("forbids non-admins", async () => {
    asNonAdmin();
    const res = await run(VALID);
    expect(res.status).toBe(403);
    expect(recordProjectChartString).not.toHaveBeenCalled();
  });

  it("rejects an unknown intent", async () => {
    asAdmin();
    const res = await run({ ...VALID, intent: "bogus" });
    expect(res.status).toBe(400);
    expect(recordProjectChartString).not.toHaveBeenCalled();
  });

  it("requires a project and term", async () => {
    asAdmin();
    expect((await run({ ...VALID, projectId: "" })).status).toBe(400);
    expect((await run({ ...VALID, termId: "" })).status).toBe(400);
    expect(recordProjectChartString).not.toHaveBeenCalled();
  });

  it("requires a non-blank chart string", async () => {
    asAdmin();
    const res = await run({ ...VALID, chartString: "   " });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "Chart string is required." });
    expect(recordProjectChartString).not.toHaveBeenCalled();
  });

  it("404s a project that isn't staffed in the term", async () => {
    asAdmin();
    (prisma as any).project.findFirst.mockResolvedValueOnce(null);
    const res = await run(VALID);
    expect(res.status).toBe(404);
    expect((prisma as any).project.findFirst).toHaveBeenCalledWith({
      where: { id: "p-lapsed", assignments: { some: { termId: "term-25f" } } },
      select: { id: true },
    });
    expect(recordProjectChartString).not.toHaveBeenCalled();
  });

  it("records the string through the shared audited write path as the admin", async () => {
    asAdmin();
    const res = await run({ ...VALID, chartString: "  18.722.161028.128512.3000  " });
    expect(res.status).toBe(200);
    expect(recordProjectChartString).toHaveBeenCalledWith({
      projectId: "p-lapsed",
      termId: "term-25f",
      chartString: "18.722.161028.128512.3000",
      createdById: ADMIN_ID,
    });
    expect(await res.json()).toEqual({
      ok: true,
      projectId: "p-lapsed",
      chartString: "18.722.161028.128512.3000",
      warnings: ["Unexpected org."],
    });
  });

  it("returns validation errors as a 400 without throwing", async () => {
    asAdmin();
    vi.mocked(recordProjectChartString).mockRejectedValueOnce(
      new (ChartStringValidationError as any)("Chart string could not be parsed."),
    );
    const res = await run({ ...VALID, chartString: "nonsense" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      projectId: "p-lapsed",
      error: "Chart string could not be parsed.",
    });
  });

  it("rethrows unexpected errors", async () => {
    asAdmin();
    vi.mocked(recordProjectChartString).mockRejectedValueOnce(new Error("db down"));
    await expect(run(VALID)).rejects.toThrow("db down");
  });
});

describe("payroll.csv loader — auth gate + view", () => {
  it("redirects anonymous users to /login", async () => {
    asAnon();
    const res = (await csvLoader({
      request: req("http://localhost/admin/payroll.csv?view=summary"),
      params: {},
      context: {},
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `/login?next=${encodeURIComponent("/admin/payroll.csv?view=summary")}`,
    );
  });

  it("returns 403 for non-admins", async () => {
    asNonAdmin();
    const res = (await csvLoader({
      request: req("http://localhost/admin/payroll.csv?view=summary"),
      params: {},
      context: {},
    } as any)) as Response;
    expect(res.status).toBe(403);
    expect(getReconciliation).not.toHaveBeenCalled();
  });

  it("rejects an unknown view with 400", async () => {
    asAdmin();
    const res = (await csvLoader({
      request: req("http://localhost/admin/payroll.csv?view=bogus"),
      params: {},
      context: {},
    } as any)) as Response;
    expect(res.status).toBe(400);
    expect(getReconciliation).not.toHaveBeenCalled();
  });

  it("streams a CSV for a valid view as an admin", async () => {
    asAdmin();
    const res = (await csvLoader({
      request: req("http://localhost/admin/payroll.csv?view=summary&term=term-25f"),
      params: {},
      context: {},
    } as any)) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/text\/csv/);
    expect(res.headers.get("Content-Disposition")).toMatch(/payroll-summary-25F-/);
    const body = await res.text();
    expect(body).toMatch(/DALI hours/);
  });
});
