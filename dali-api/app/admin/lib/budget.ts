// Budget module: revenue (admin-entered) vs computed payroll expense per
// project / chart-string / term, with Dartmouth PATEO indirect-cost
// discounting. Ported from dali-hr/app/services/budget.server.ts with dali-os
// substitutions (projectId-keyed expense seam, cuid ids, Decimal → number at
// this boundary — React Router single-fetch can't serialize Prisma Decimal).

import { prisma } from "~/lib/db";
import { decimalToNumber, roundCents } from "~/lib/money";
import { computeExpensesByProjectChartTerm } from "~/admin/lib/payroll-reconcile.server";
import {
  PATEO_EFFECTIVE_RATE,
  PROJECT_TYPES,
  type ProjectType,
  type BudgetRow,
  type BudgetGroup,
  type BudgetData,
} from "~/admin/lib/budget.shared";

// The client-safe budget surface (PATEO constant, project-type list, and the
// serialized row/group/data shapes) lives in budget.shared.ts so the Budget tab
// component can import it without pulling this server module into the client
// bundle. Re-exported here for server callers, tests, and the CSV route.
export {
  PATEO_EFFECTIVE_RATE,
  PROJECT_TYPES,
  type ProjectType,
  type BudgetRow,
  type BudgetGroup,
  type BudgetData,
};

function adjustRevenue(revenue: number, projectType: string | null): number {
  return projectType === "DALI PATEO"
    ? roundCents(revenue * PATEO_EFFECTIVE_RATE)
    : revenue;
}

// ─── getBudgetData ───────────────────────────────────────────────────────────

const NON_PROJECT_GROUP_NAME = "Non-project (Core / Instructor / External / unmatched)";

/**
 * Full budget breakdown for a term. Reads BudgetEntry/BudgetNote, merges with
 * the payroll expense seam on (projectId, chartString), applies the PATEO
 * adjustment, and groups by project (+ one non-project bucket). Expense-only
 * lines (no BudgetEntry) appear with revenue 0. An empty term returns zeroed
 * totals with no groups — never throws.
 */
export async function getBudgetData(termId: string): Promise<BudgetData> {
  const [entries, notes, expenses, projects] = await Promise.all([
    prisma.budgetEntry.findMany({ where: { termId } }),
    prisma.budgetNote.findMany({ where: { termId } }),
    computeExpensesByProjectChartTerm(termId),
    prisma.project.findMany({ select: { id: true, name: true } }),
  ]);

  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  // Note lookup keyed by (projectId, chartString). NULL projectId → "" sentinel.
  const noteByKey = new Map<string, { id: string; note: string }>();
  for (const n of notes) {
    noteByKey.set(mergeKey(n.projectId, n.chartString), { id: n.id, note: n.note });
  }

  // Merge budget entries + expenses into one row per (projectId, chartString).
  const rowByKey = new Map<string, BudgetRow>();

  for (const e of entries) {
    const revenue = decimalToNumber(e.revenue);
    const adjustedRevenue = adjustRevenue(revenue, e.projectType);
    const key = mergeKey(e.projectId, e.chartString);
    const note = noteByKey.get(key) ?? null;
    rowByKey.set(key, {
      entryId: e.id,
      noteId: note?.id ?? null,
      projectId: e.projectId,
      chartString: e.chartString,
      projectType: e.projectType,
      revenue,
      adjustedRevenue,
      expense: 0,
      net: adjustedRevenue,
      note: note?.note ?? null,
      isPateo: e.projectType === "DALI PATEO",
    });
  }

  for (const x of expenses) {
    const key = mergeKey(x.projectId, x.chartString);
    const existing = rowByKey.get(key);
    if (existing) {
      existing.expense = x.earnings;
      existing.net = roundCents(existing.adjustedRevenue - x.earnings);
    } else {
      const note = noteByKey.get(key) ?? null;
      rowByKey.set(key, {
        entryId: null,
        noteId: note?.id ?? null,
        projectId: x.projectId,
        chartString: x.chartString,
        projectType: null,
        revenue: 0,
        adjustedRevenue: 0,
        expense: x.earnings,
        net: roundCents(-x.earnings),
        note: note?.note ?? null,
        isPateo: false,
      });
    }
  }

  // Group by project; null projectId → the shared non-project bucket.
  const groupByProject = new Map<string | null, BudgetRow[]>();
  for (const row of rowByKey.values()) {
    const list = groupByProject.get(row.projectId) ?? [];
    list.push(row);
    groupByProject.set(row.projectId, list);
  }

  const groups: BudgetGroup[] = [];
  for (const [projectId, rows] of groupByProject) {
    rows.sort((a, b) => a.chartString.localeCompare(b.chartString));
    const totalRevenue = roundCents(rows.reduce((s, r) => s + r.revenue, 0));
    const totalAdjustedRevenue = roundCents(
      rows.reduce((s, r) => s + r.adjustedRevenue, 0),
    );
    const totalExpense = roundCents(rows.reduce((s, r) => s + r.expense, 0));
    groups.push({
      projectId,
      projectName:
        projectId === null
          ? NON_PROJECT_GROUP_NAME
          : (projectName.get(projectId) ?? "Unknown project"),
      rows,
      totalRevenue,
      totalAdjustedRevenue,
      totalExpense,
      totalNet: roundCents(totalAdjustedRevenue - totalExpense),
    });
  }

  // Real projects sorted by name; the non-project bucket always last.
  groups.sort((a, b) => {
    if (a.projectId === null) return 1;
    if (b.projectId === null) return -1;
    return a.projectName.localeCompare(b.projectName);
  });

  const grandTotalRevenue = roundCents(
    groups.reduce((s, g) => s + g.totalRevenue, 0),
  );
  const grandTotalAdjustedRevenue = roundCents(
    groups.reduce((s, g) => s + g.totalAdjustedRevenue, 0),
  );
  const grandTotalExpense = roundCents(
    groups.reduce((s, g) => s + g.totalExpense, 0),
  );

  return {
    groups,
    grandTotalRevenue,
    grandTotalAdjustedRevenue,
    grandTotalExpense,
    grandTotalNet: roundCents(grandTotalAdjustedRevenue - grandTotalExpense),
  };
}

/** Merge key for a budget line. NULL projectId collapses to "" so the sentinel
 * is stable across the note map, the row map, and the expense seam. */
function mergeKey(projectId: string | null, chartString: string): string {
  return `${projectId ?? ""}::${chartString}`;
}

// ─── mutation helpers ────────────────────────────────────────────────────────

// Postgres treats NULLs as distinct in a unique index, so `upsert` on the
// composite (projectId, chartString, termId) does NOT dedupe when projectId is
// null. Every mutation therefore does a findFirst-before-write on the exact
// key, using Prisma's native `upsert` only as a fast path for the non-null case.

type BudgetKey = {
  projectId: string | null;
  chartString: string;
  termId: string;
};

async function findEntry(key: BudgetKey) {
  return prisma.budgetEntry.findFirst({
    where: {
      projectId: key.projectId,
      chartString: key.chartString,
      termId: key.termId,
    },
  });
}

async function findNote(key: BudgetKey) {
  return prisma.budgetNote.findFirst({
    where: {
      projectId: key.projectId,
      chartString: key.chartString,
      termId: key.termId,
    },
  });
}

/** Create or update the revenue on a budget line. */
export async function upsertRevenue(key: BudgetKey, revenue: number): Promise<void> {
  const existing = await findEntry(key);
  if (existing) {
    await prisma.budgetEntry.update({
      where: { id: existing.id },
      data: { revenue },
    });
  } else {
    await prisma.budgetEntry.create({
      data: {
        projectId: key.projectId,
        chartString: key.chartString,
        termId: key.termId,
        revenue,
      },
    });
  }
}

/** Delete a budget entry by id (its note, if any, is left as-is). */
export async function deleteEntry(id: string): Promise<void> {
  await prisma.budgetEntry.delete({ where: { id } });
}

/**
 * Move a budget line to a new chart string. Because chartString is part of the
 * unique key we can't just update in place if the target already exists, so we
 * guard against a collision, then update. The note (if any) moves with it.
 */
export async function updateChartString(
  key: BudgetKey,
  newChartString: string,
): Promise<void> {
  const existing = await findEntry(key);
  if (!existing) {
    throw new Error("Budget entry not found");
  }
  const collision = await findEntry({ ...key, chartString: newChartString });
  if (collision && collision.id !== existing.id) {
    throw new Error("A budget entry already exists for that chart string");
  }
  await prisma.$transaction(async (tx) => {
    await tx.budgetEntry.update({
      where: { id: existing.id },
      data: { chartString: newChartString },
    });
    const note = await tx.budgetNote.findFirst({
      where: {
        projectId: key.projectId,
        chartString: key.chartString,
        termId: key.termId,
      },
    });
    if (note) {
      await tx.budgetNote.update({
        where: { id: note.id },
        data: { chartString: newChartString },
      });
    }
  });
}

/** Create/update a note on a budget line, or delete it when the text is empty. */
export async function upsertNote(key: BudgetKey, note: string): Promise<void> {
  const existing = await findNote(key);
  if (!note.trim()) {
    if (existing) await prisma.budgetNote.delete({ where: { id: existing.id } });
    return;
  }
  if (existing) {
    await prisma.budgetNote.update({ where: { id: existing.id }, data: { note } });
  } else {
    await prisma.budgetNote.create({
      data: {
        projectId: key.projectId,
        chartString: key.chartString,
        termId: key.termId,
        note,
      },
    });
  }
}

/**
 * Set (or clear) the project type on a budget line, creating the entry with
 * revenue 0 if it doesn't exist yet (so an expense-only row can be typed).
 */
export async function updateProjectType(
  key: BudgetKey,
  projectType: string | null,
): Promise<void> {
  const existing = await findEntry(key);
  if (existing) {
    await prisma.budgetEntry.update({
      where: { id: existing.id },
      data: { projectType },
    });
  } else {
    await prisma.budgetEntry.create({
      data: {
        projectId: key.projectId,
        chartString: key.chartString,
        termId: key.termId,
        revenue: 0,
        projectType,
      },
    });
  }
}
