import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), forbidden: vi.fn(() => Response.json({}, { status: 403 })) }));
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn().mockResolvedValue(true), getUserRoles: vi.fn().mockResolvedValue({}) }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn().mockResolvedValue({ termId: "t1", terms: [{ id: "t1", code: "26F" }], selected: "t1" }) }));
vi.mock("~/admin/lib/payroll-reconcile.server", () => ({ getReconciliation: vi.fn() }));
vi.mock("~/admin/lib/budget", () => ({ getBudgetData: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getBudgetData } from "~/admin/lib/budget";
import { loader } from "~/admin/routes/admin.payroll.csv";

const BUDGET = {
  groups: [
    {
      projectName: "Alpha",
      rows: [{ chartString: "cs-1", projectType: null, revenue: 100, adjustedRevenue: 100, expense: 10, purchases: 5, net: 85 }],
    },
  ],
  grandTotalRevenue: 100,
  grandTotalAdjustedRevenue: 100,
  grandTotalExpense: 10,
  grandTotalPurchases: 5,
  grandTotalNet: 85,
};

const run = async () => {
  const res = (await loader({ request: new Request("http://x/admin/payroll/csv?view=budget"), params: {}, context: {} } as any)) as Response;
  return (await res.text()).trim().split("\r\n");
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "a1" } } as any);
  vi.mocked(getBudgetData).mockResolvedValue(BUDGET as any);
});

describe("budget CSV purchases column", () => {
  it("adds Purchases when the expenses flag is on", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    const lines = await run();
    expect(getBudgetData).toHaveBeenCalledWith("t1", { purchases: true });
    expect(lines[0]).toBe("Project,Chart String,Type,Revenue,Adj. Revenue,Expense,Purchases,Net");
    expect(lines[1]).toBe("Alpha,cs-1,,100,100,10,5,85");
    expect(lines[2]).toBe("Grand total,,,100,100,10,5,85");
  });

  it("keeps the old columns when the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const lines = await run();
    expect(getBudgetData).toHaveBeenCalledWith("t1", { purchases: false });
    expect(lines[0]).toBe("Project,Chart String,Type,Revenue,Adj. Revenue,Expense,Net");
    expect(lines[1]).toBe("Alpha,cs-1,,100,100,10,85");
  });
});
