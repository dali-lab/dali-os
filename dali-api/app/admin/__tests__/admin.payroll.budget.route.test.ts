import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn((_req: Request) =>
    Response.json({ error: "Forbidden" }, { status: 403 }),
  ),
}));
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn() }));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
// Mutation helpers + the loader's data source are stubbed so this stays a pure
// gating/validation/dispatch test. Plain factory only — no importActual: the
// real budget.ts imports ~/lib/db, and loading it here would require the
// generated Prisma client (absent in CI, where prisma generate never runs).
// The route gets the real PROJECT_TYPES from budget.shared (client-safe).
vi.mock("~/admin/lib/budget", () => ({
  getBudgetData: vi.fn(),
  upsertRevenue: vi.fn(),
  deleteEntry: vi.fn(),
  updateChartString: vi.fn(),
  upsertNote: vi.fn(),
  updateProjectType: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import {
  getBudgetData,
  upsertRevenue,
  deleteEntry,
  updateChartString,
  upsertNote,
  updateProjectType,
} from "~/admin/lib/budget";
import {
  loader,
  action,
} from "~/admin/routes/admin.payroll.budget";

const ADMIN_ID = "admin-1";

const EMPTY_BUDGET = {
  groups: [],
  grandTotalRevenue: 0,
  grandTotalAdjustedRevenue: 0,
  grandTotalExpense: 0,
  grandTotalNet: 0,
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

function getReq() {
  return new Request("http://localhost/admin/payroll/budget?term=term-25f");
}
function postReq(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request("http://localhost/admin/payroll/budget", {
    method: "POST",
    body: fd,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTermFilter).mockResolvedValue({
    terms: [{ id: "term-25f", code: "25F" }],
    selected: "term-25f",
    termId: "term-25f",
    isAll: false,
  } as any);
  vi.mocked(getBudgetData).mockResolvedValue(EMPTY_BUDGET as any);
});

describe("budget loader — auth gate", () => {
  it("redirects anonymous users to /login", async () => {
    asAnon();
    const res = (await loader({ request: getReq(), params: {}, context: {} } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    expect(getBudgetData).not.toHaveBeenCalled();
  });

  it("returns 403 for non-admins (forbidden)", async () => {
    asNonAdmin();
    const res = (await loader({ request: getReq(), params: {}, context: {} } as any)) as Response;
    expect(res.status).toBe(403);
    expect(getBudgetData).not.toHaveBeenCalled();
  });

  it("returns budget data for an admin", async () => {
    asAdmin();
    const res = (await loader({ request: getReq(), params: {}, context: {} } as any)) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.termId).toBe("term-25f");
    expect(getBudgetData).toHaveBeenCalledWith("term-25f");
  });
});

describe("budget action — auth gate", () => {
  it("returns the auth response for anonymous callers (no mutation)", async () => {
    asAnon();
    const res = await action({
      request: postReq({ intent: "upsert-revenue", projectId: "", chartString: "cs", termId: "t", revenue: "10" }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(401);
    expect(upsertRevenue).not.toHaveBeenCalled();
  });

  it("returns 403 for non-admin callers (no mutation)", async () => {
    asNonAdmin();
    const res = await action({
      request: postReq({ intent: "upsert-revenue", projectId: "", chartString: "cs", termId: "t", revenue: "10" }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(403);
    expect(upsertRevenue).not.toHaveBeenCalled();
  });
});

describe("budget action — intent dispatch + validation", () => {
  beforeEach(() => asAdmin());

  it("upsert-revenue: coerces revenue and passes a null projectId through", async () => {
    const res = await action({
      request: postReq({
        intent: "upsert-revenue",
        projectId: "",
        chartString: "cs-core",
        termId: "term-25f",
        revenue: "1234.50",
      }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(200);
    expect(upsertRevenue).toHaveBeenCalledWith(
      { projectId: null, chartString: "cs-core", termId: "term-25f" },
      1234.5,
    );
  });

  it("upsert-revenue: rejects a non-numeric revenue with 400 (no mutation)", async () => {
    const res = await action({
      request: postReq({
        intent: "upsert-revenue",
        projectId: "p1",
        chartString: "cs",
        termId: "t",
        revenue: "not-a-number",
      }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(upsertRevenue).not.toHaveBeenCalled();
  });

  it("upsert-revenue: rejects a blank chartString with 400", async () => {
    const res = await action({
      request: postReq({
        intent: "upsert-revenue",
        projectId: "p1",
        chartString: "",
        termId: "t",
        revenue: "10",
      }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(upsertRevenue).not.toHaveBeenCalled();
  });

  it("delete-entry: calls deleteEntry with the id", async () => {
    const res = await action({
      request: postReq({ intent: "delete-entry", entryId: "e1" }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(200);
    expect(deleteEntry).toHaveBeenCalledWith("e1");
  });

  it("delete-entry: rejects a missing id with 400", async () => {
    const res = await action({
      request: postReq({ intent: "delete-entry", entryId: "" }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it("update-chartstring: passes key + newChartString", async () => {
    const res = await action({
      request: postReq({
        intent: "update-chartstring",
        projectId: "p1",
        chartString: "cs-old",
        termId: "t",
        newChartString: "cs-new",
      }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(200);
    expect(updateChartString).toHaveBeenCalledWith(
      { projectId: "p1", chartString: "cs-old", termId: "t" },
      "cs-new",
    );
  });

  it("update-chartstring: surfaces a collision error as 400", async () => {
    vi.mocked(updateChartString).mockRejectedValueOnce(
      new Error("A budget entry already exists for that chart string"),
    );
    const res = await action({
      request: postReq({
        intent: "update-chartstring",
        projectId: "p1",
        chartString: "cs-old",
        termId: "t",
        newChartString: "cs-new",
      }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/i);
  });

  it("upsert-note: accepts an empty note (clear path)", async () => {
    const res = await action({
      request: postReq({
        intent: "upsert-note",
        projectId: "",
        chartString: "cs",
        termId: "t",
        note: "",
      }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(200);
    expect(upsertNote).toHaveBeenCalledWith(
      { projectId: null, chartString: "cs", termId: "t" },
      "",
    );
  });

  it("update-project-type: accepts a valid type", async () => {
    const res = await action({
      request: postReq({
        intent: "update-project-type",
        projectId: "p1",
        chartString: "cs",
        termId: "t",
        projectType: "DALI PATEO",
      }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(200);
    expect(updateProjectType).toHaveBeenCalledWith(
      { projectId: "p1", chartString: "cs", termId: "t" },
      "DALI PATEO",
    );
  });

  it("update-project-type: coerces an empty string to null (clear type)", async () => {
    const res = await action({
      request: postReq({
        intent: "update-project-type",
        projectId: "p1",
        chartString: "cs",
        termId: "t",
        projectType: "",
      }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(200);
    expect(updateProjectType).toHaveBeenCalledWith(
      { projectId: "p1", chartString: "cs", termId: "t" },
      null,
    );
  });

  it("update-project-type: rejects an unknown type with 400", async () => {
    const res = await action({
      request: postReq({
        intent: "update-project-type",
        projectId: "p1",
        chartString: "cs",
        termId: "t",
        projectType: "Bogus GL",
      }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(updateProjectType).not.toHaveBeenCalled();
  });

  it("rejects an unknown intent with 400", async () => {
    const res = await action({
      request: postReq({ intent: "nonsense" }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(400);
  });
});
