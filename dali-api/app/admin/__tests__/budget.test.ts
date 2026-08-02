import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
// The expense seam is exercised on its own in the reconcile tests — here we
// stub it so the budget merge/PATEO/grouping logic is tested in isolation.
vi.mock("~/admin/lib/payroll-reconcile.server", () => ({
  computeExpensesByProjectChartTerm: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { computeExpensesByProjectChartTerm } from "~/admin/lib/payroll-reconcile.server";
import {
  getBudgetData,
  upsertRevenue,
  updateChartString,
  upsertNote,
  updateProjectType,
  PATEO_EFFECTIVE_RATE,
} from "~/admin/lib/budget";

const TERM = "term-25f";

type EntryStub = {
  id: string;
  projectId: string | null;
  chartString: string;
  termId: string;
  revenue: number;
  projectType: string | null;
};

function setup(opts: {
  entries?: EntryStub[];
  notes?: Array<{ id: string; projectId: string | null; chartString: string; note: string }>;
  expenses?: Array<{ projectId: string | null; chartString: string; earnings: number }>;
  projects?: Array<{ id: string; name: string }>;
}) {
  (prisma.budgetEntry.findMany as any).mockResolvedValue(opts.entries ?? []);
  (prisma.budgetNote.findMany as any).mockResolvedValue(opts.notes ?? []);
  (prisma.project.findMany as any).mockResolvedValue(opts.projects ?? []);
  vi.mocked(computeExpensesByProjectChartTerm).mockResolvedValue(opts.expenses ?? []);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getBudgetData — PATEO adjustment", () => {
  it("scales revenue ONLY for DALI PATEO; other types pass through", async () => {
    setup({
      projects: [
        { id: "p1", name: "Alpha" },
        { id: "p2", name: "Beta" },
        { id: "p3", name: "Gamma" },
        { id: "p4", name: "Delta" },
      ],
      entries: [
        { id: "e1", projectId: "p1", chartString: "cs-1", termId: TERM, revenue: 1000, projectType: "DALI PATEO" },
        { id: "e2", projectId: "p2", chartString: "cs-2", termId: TERM, revenue: 1000, projectType: "Other PATEO" },
        { id: "e3", projectId: "p3", chartString: "cs-3", termId: TERM, revenue: 1000, projectType: "DALI GL" },
        { id: "e4", projectId: "p4", chartString: "cs-4", termId: TERM, revenue: 1000, projectType: null },
      ],
    });

    const data = await getBudgetData(TERM);
    const byProject = Object.fromEntries(
      data.groups.map((g) => [g.projectName, g.rows[0]]),
    );

    // DALI PATEO: 1000 * PATEO_EFFECTIVE_RATE
    expect(byProject["Alpha"].adjustedRevenue).toBeCloseTo(1000 * PATEO_EFFECTIVE_RATE, 2);
    expect(byProject["Alpha"].isPateo).toBe(true);
    // Everything else: unscaled.
    expect(byProject["Beta"].adjustedRevenue).toBe(1000);
    expect(byProject["Gamma"].adjustedRevenue).toBe(1000);
    expect(byProject["Delta"].adjustedRevenue).toBe(1000);
    expect(byProject["Beta"].isPateo).toBe(false);
  });

  it("the constant carries the documented provenance value", () => {
    expect(PATEO_EFFECTIVE_RATE).toBeCloseTo(1.47625 / 1.635, 10);
    expect(PATEO_EFFECTIVE_RATE).toBeCloseTo(0.9029, 3);
  });
});

describe("getBudgetData — merge of revenue + expense", () => {
  it("produces both-sided, revenue-only, and expense-only rows", async () => {
    setup({
      projects: [
        { id: "p1", name: "Alpha" },
        { id: "p2", name: "Beta" },
      ],
      entries: [
        // both: has revenue AND an expense
        { id: "e1", projectId: "p1", chartString: "cs-both", termId: TERM, revenue: 500, projectType: "DALI GL" },
        // revenue-only: no matching expense
        { id: "e2", projectId: "p2", chartString: "cs-rev", termId: TERM, revenue: 300, projectType: "DALI GL" },
      ],
      expenses: [
        { projectId: "p1", chartString: "cs-both", earnings: 200 },
        // expense-only: no budget entry (attributes to project p1)
        { projectId: "p1", chartString: "cs-exp", earnings: 150 },
      ],
    });

    const data = await getBudgetData(TERM);
    const alpha = data.groups.find((g) => g.projectName === "Alpha")!;
    const both = alpha.rows.find((r) => r.chartString === "cs-both")!;
    const exp = alpha.rows.find((r) => r.chartString === "cs-exp")!;
    const beta = data.groups.find((g) => g.projectName === "Beta")!;
    const rev = beta.rows.find((r) => r.chartString === "cs-rev")!;

    expect(both.revenue).toBe(500);
    expect(both.expense).toBe(200);
    expect(both.net).toBe(300);
    expect(both.entryId).toBe("e1");

    expect(rev.revenue).toBe(300);
    expect(rev.expense).toBe(0);
    expect(rev.net).toBe(300);

    expect(exp.revenue).toBe(0);
    expect(exp.expense).toBe(150);
    expect(exp.net).toBe(-150);
    expect(exp.entryId).toBeNull();
  });

  it("groups null-project expense lines into the non-project bucket, sorted last", async () => {
    setup({
      projects: [{ id: "p1", name: "Alpha" }],
      expenses: [
        { projectId: "p1", chartString: "cs-p1", earnings: 100 },
        { projectId: null, chartString: "cs-core", earnings: 40 },
        { projectId: null, chartString: "cs-ext", earnings: 60 },
      ],
    });

    const data = await getBudgetData(TERM);
    expect(data.groups).toHaveLength(2);
    // Non-project bucket is always last.
    const last = data.groups[data.groups.length - 1];
    expect(last.projectId).toBeNull();
    expect(last.rows).toHaveLength(2);
    expect(last.totalExpense).toBe(100);
  });

  it("attaches notes to the matching (projectId, chartString) row, including null-project", async () => {
    setup({
      projects: [{ id: "p1", name: "Alpha" }],
      entries: [
        { id: "e1", projectId: "p1", chartString: "cs-1", termId: TERM, revenue: 100, projectType: null },
      ],
      notes: [
        { id: "n1", projectId: "p1", chartString: "cs-1", note: "budgeted line" },
        { id: "n2", projectId: null, chartString: "cs-core", note: "lab overhead" },
      ],
      expenses: [{ projectId: null, chartString: "cs-core", earnings: 10 }],
    });

    const data = await getBudgetData(TERM);
    const alphaRow = data.groups.find((g) => g.projectId === "p1")!.rows[0];
    const bucketRow = data.groups.find((g) => g.projectId === null)!.rows[0];
    expect(alphaRow.note).toBe("budgeted line");
    expect(alphaRow.noteId).toBe("n1");
    expect(bucketRow.note).toBe("lab overhead");
  });
});

describe("getBudgetData — totals", () => {
  it("computes per-group and grand totals", async () => {
    setup({
      projects: [
        { id: "p1", name: "Alpha" },
        { id: "p2", name: "Beta" },
      ],
      entries: [
        { id: "e1", projectId: "p1", chartString: "cs-1", termId: TERM, revenue: 1000, projectType: "DALI PATEO" },
        { id: "e2", projectId: "p1", chartString: "cs-2", termId: TERM, revenue: 500, projectType: "DALI GL" },
        { id: "e3", projectId: "p2", chartString: "cs-3", termId: TERM, revenue: 800, projectType: "DALI GL" },
      ],
      expenses: [
        { projectId: "p1", chartString: "cs-1", earnings: 300 },
        { projectId: "p2", chartString: "cs-3", earnings: 900 },
      ],
    });

    const data = await getBudgetData(TERM);
    const alpha = data.groups.find((g) => g.projectName === "Alpha")!;
    const beta = data.groups.find((g) => g.projectName === "Beta")!;

    const alphaAdj = 1000 * PATEO_EFFECTIVE_RATE + 500;
    expect(alpha.totalRevenue).toBe(1500);
    expect(alpha.totalAdjustedRevenue).toBeCloseTo(alphaAdj, 2);
    expect(alpha.totalExpense).toBe(300);
    expect(alpha.totalNet).toBeCloseTo(alphaAdj - 300, 2);

    expect(beta.totalNet).toBe(800 - 900); // -100

    expect(data.grandTotalRevenue).toBe(2300);
    expect(data.grandTotalAdjustedRevenue).toBeCloseTo(alphaAdj + 800, 2);
    expect(data.grandTotalExpense).toBe(1200);
    expect(data.grandTotalNet).toBeCloseTo(alphaAdj + 800 - 1200, 2);
  });

  it("returns zeroed totals and no groups for an empty term (no throw)", async () => {
    setup({});
    const data = await getBudgetData(TERM);
    expect(data.groups).toHaveLength(0);
    expect(data.grandTotalRevenue).toBe(0);
    expect(data.grandTotalAdjustedRevenue).toBe(0);
    expect(data.grandTotalExpense).toBe(0);
    expect(data.grandTotalNet).toBe(0);
  });
});

describe("mutation helpers — null-project findFirst-before-write", () => {
  it("upsertRevenue creates when no null-project row exists (findFirst, no upsert)", async () => {
    (prisma.budgetEntry.findFirst as any).mockResolvedValue(null);
    await upsertRevenue({ projectId: null, chartString: "cs-core", termId: TERM }, 250);

    expect(prisma.budgetEntry.findFirst).toHaveBeenCalledWith({
      where: { projectId: null, chartString: "cs-core", termId: TERM },
    });
    expect(prisma.budgetEntry.create).toHaveBeenCalledWith({
      data: { projectId: null, chartString: "cs-core", termId: TERM, revenue: 250 },
    });
    expect(prisma.budgetEntry.upsert).not.toHaveBeenCalled();
  });

  it("upsertRevenue updates the existing null-project row (dedupes — no second create)", async () => {
    (prisma.budgetEntry.findFirst as any).mockResolvedValue({ id: "e-null" });
    await upsertRevenue({ projectId: null, chartString: "cs-core", termId: TERM }, 999);

    expect(prisma.budgetEntry.update).toHaveBeenCalledWith({
      where: { id: "e-null" },
      data: { revenue: 999 },
    });
    expect(prisma.budgetEntry.create).not.toHaveBeenCalled();
  });

  it("updateProjectType creates an entry (revenue 0) when none exists yet", async () => {
    (prisma.budgetEntry.findFirst as any).mockResolvedValue(null);
    await updateProjectType({ projectId: "p1", chartString: "cs-1", termId: TERM }, "DALI PATEO");
    expect(prisma.budgetEntry.create).toHaveBeenCalledWith({
      data: { projectId: "p1", chartString: "cs-1", termId: TERM, revenue: 0, projectType: "DALI PATEO" },
    });
  });

  it("upsertNote deletes the note when the text is blank", async () => {
    (prisma.budgetNote.findFirst as any).mockResolvedValue({ id: "n1" });
    await upsertNote({ projectId: null, chartString: "cs-core", termId: TERM }, "   ");
    expect(prisma.budgetNote.delete).toHaveBeenCalledWith({ where: { id: "n1" } });
    expect(prisma.budgetNote.create).not.toHaveBeenCalled();
  });

  it("updateChartString guards against a colliding target chart string", async () => {
    (prisma.budgetEntry.findFirst as any)
      .mockResolvedValueOnce({ id: "e1" }) // the source row
      .mockResolvedValueOnce({ id: "e2" }); // a different row already at the target
    await expect(
      updateChartString({ projectId: "p1", chartString: "cs-old", termId: TERM }, "cs-new"),
    ).rejects.toThrow(/already exists/i);
  });

  it("updateChartString moves the entry (and its note) inside a transaction", async () => {
    (prisma.budgetEntry.findFirst as any)
      .mockResolvedValueOnce({ id: "e1" }) // source
      .mockResolvedValueOnce(null); // no collision at target
    const txEntry = { update: vi.fn() };
    const txNote = { findFirst: vi.fn().mockResolvedValue({ id: "n1" }), update: vi.fn() };
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb({ budgetEntry: txEntry, budgetNote: txNote }),
    );

    await updateChartString({ projectId: "p1", chartString: "cs-old", termId: TERM }, "cs-new");

    expect(txEntry.update).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: { chartString: "cs-new" },
    });
    expect(txNote.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: { chartString: "cs-new" },
    });
  });
});
