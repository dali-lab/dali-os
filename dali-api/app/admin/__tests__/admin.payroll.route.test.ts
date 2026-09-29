import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
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
vi.mock("~/lib/chart-string.server", () => ({
  resolveChartStringsForTerm: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import { getReconciliation } from "~/admin/lib/payroll-reconcile.server";
import { resolveChartStringsForTerm } from "~/lib/chart-string.server";
import { prisma } from "~/lib/db";
import { loader as pageLoader } from "~/admin/routes/admin.payroll";
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
      request: req("http://localhost/admin/payroll"),
      params: {},
      context: {},
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `/login?next=${encodeURIComponent("/admin/payroll")}`,
    );
    expect(getReconciliation).not.toHaveBeenCalled();
  });

  it("redirects non-admins to /admin/members", async () => {
    asNonAdmin();
    const res = (await pageLoader({
      request: req("http://localhost/admin/payroll"),
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
      request: req("http://localhost/admin/payroll?term=term-25f"),
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
      request: req("http://localhost/admin/payroll?term=term-25f"),
      params: {},
      context: {},
    } as any);
    expect((data as any).missingChartStrings).toEqual(["zebraMD"]);
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
