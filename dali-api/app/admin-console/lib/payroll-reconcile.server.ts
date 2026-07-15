// Server edges for payroll reconciliation: fetch the authoritative data via
// Prisma, hand plain (Decimal-free) objects to the pure collation core, and
// return JSON-serializable results. All Decimal → number conversion happens
// here — React Router single-fetch can't serialize Prisma Decimal.

import { prisma } from "~/lib/db";
import { decimalToNumber } from "~/lib/money";
import {
  collate,
  type CollatedResult,
  type CollationEntry,
  type CollationLookup,
  type CollationUser,
  type CollationAssignment,
  type CollationProject,
} from "~/admin-console/lib/payroll-collation";
import {
  buildPayrollRows,
  buildCoreRows,
  buildInstructorRows,
  resolveJobCode,
  type PayrollRow,
} from "~/admin-console/lib/payroll-export";

// ─── getReconciliation ───────────────────────────────────────────────────────

export type ReconciliationOptions = {
  payPeriodIds?: string[];
};

/** One surfaced timesheet note, JSON-safe, attached to a (netId, jobId) row. */
export type TimesheetNoteView = {
  note: string;
  validatedChartstring: string | null;
  linkToTimesheet: string | null;
  payPeriodName: string;
};

/**
 * The reconciliation breakdown plus surfaced notes. Notes live at the server
 * edge (the pure collation core is deliberately Prisma-free) keyed by
 * `${netId}::${jobId}` so the Payroll Data rows — which carry both — can look
 * up their notes and show a count indicator.
 */
export type ReconciliationResult = CollatedResult & {
  notesByJobKey: Record<string, TimesheetNoteView[]>;
};

const noteKey = (netId: string, jobId: string) => `${netId}::${jobId}`;

/**
 * Full reconciliation breakdown for a term. Optionally scope to specific pay
 * periods. Returns the plain (JSON-safe) result the page consumes, with any
 * TimesheetNotes for the term's pay periods attached under `notesByJobKey`.
 *
 * Rate-mismatch discrepancies are only computed when the term is the currently
 * active term (there's no wage history, so comparing a past term against
 * today's lookup rates would spray false mismatches — see plan §decision 2).
 */
export async function getReconciliation(
  termId: string,
  options: ReconciliationOptions = {},
): Promise<ReconciliationResult> {
  const { payPeriodIds } = options;

  // Pay periods in this term (optionally narrowed to a chosen subset).
  const periods = await prisma.payPeriod.findMany({
    where: {
      termId,
      ...(payPeriodIds && payPeriodIds.length > 0
        ? { id: { in: payPeriodIds } }
        : {}),
    },
    select: { id: true },
  });
  const periodIds = periods.map((p) => p.id);

  // Short-circuit: no periods → empty collation (still shape-valid).
  if (periodIds.length === 0) {
    return {
      ...collate({
        entries: [],
        lookups: [],
        users: [],
        assignments: [],
        projects: [],
        isActiveTerm: await isActiveTerm(termId),
      }),
      notesByJobKey: {},
    };
  }

  const [entryRows, lookupRows, assignmentRows, projectRows, noteRows, activeTerm] =
    await Promise.all([
      prisma.timesheetEntry.findMany({
        where: { payPeriodId: { in: periodIds } },
        select: {
          employeeNetId: true,
          employeeName: true,
          jobId: true,
          jobTitle: true,
          chartString: true,
          totalShiftTime: true,
          hourlyPayRate: true,
          totalEarnings: true,
        },
      }),
      prisma.jobCodeLookup.findMany({
        select: {
          jobCode: true,
          assignmentType: true,
          level: true,
          payRateUsdHour: true,
        },
      }),
      prisma.projectAssignment.findMany({
        where: { termId },
        select: {
          user: { select: { netId: true } },
          project: {
            select: { id: true, name: true, chartString: true },
          },
        },
      }),
      prisma.project.findMany({
        select: { id: true, name: true, chartString: true },
      }),
      prisma.timesheetNote.findMany({
        where: { payPeriodId: { in: periodIds } },
        select: {
          netId: true,
          jobId: true,
          note: true,
          validatedChartstring: true,
          linkToTimesheet: true,
          payPeriod: { select: { name: true } },
        },
      }),
      isActiveTerm(termId),
    ]);

  const entries: CollationEntry[] = entryRows.map((e) => ({
    employeeNetId: e.employeeNetId,
    employeeName: e.employeeName,
    jobId: e.jobId,
    jobTitle: e.jobTitle,
    chartString: e.chartString,
    totalShiftTime: decimalToNumber(e.totalShiftTime),
    hourlyPayRate: decimalToNumber(e.hourlyPayRate),
    totalEarnings: decimalToNumber(e.totalEarnings),
  }));

  const lookups: CollationLookup[] = lookupRows.map((l) => ({
    jobCode: l.jobCode,
    assignmentType: l.assignmentType,
    level: l.level,
    payRateUsdHour: l.payRateUsdHour === null ? null : decimalToNumber(l.payRateUsdHour),
  }));

  // Users referenced by the assignment fan-out (netId → person). Collect the
  // distinct netIds from both assignments and timesheet entries so unknown
  // persons (in entries but not assigned) can still be resolved when they exist.
  const netIds = new Set<string>();
  for (const e of entries) netIds.add(e.employeeNetId);
  for (const a of assignmentRows) {
    if (a.user.netId) netIds.add(a.user.netId.toLowerCase());
  }
  const userRows = await prisma.user.findMany({
    where: { netId: { in: [...netIds] } },
    select: { netId: true, firstName: true, lastName: true },
  });
  const users: CollationUser[] = userRows
    .filter((u): u is { netId: string; firstName: string; lastName: string } =>
      u.netId !== null,
    )
    .map((u) => ({
      netId: u.netId.toLowerCase(),
      firstName: u.firstName,
      lastName: u.lastName,
    }));

  const assignments: CollationAssignment[] = assignmentRows
    .filter((a) => a.user.netId !== null)
    .map((a) => ({
      netId: (a.user.netId as string).toLowerCase(),
      projectId: a.project.id,
      projectName: a.project.name,
      projectChartString: a.project.chartString,
    }));

  const projects: CollationProject[] = projectRows.map((p) => ({
    id: p.id,
    name: p.name,
    chartString: p.chartString,
  }));

  return {
    ...collate({
      entries,
      lookups,
      users,
      assignments,
      projects,
      isActiveTerm: activeTerm,
    }),
    notesByJobKey: groupNotesByJobKey(noteRows),
  };
}

/**
 * Group note rows by `${netId}::${jobId}` for row-level lookup on the Payroll
 * Data tab. netId is lowercased to match the entries' lowercased netIds. Pure
 * (no Prisma) so the join is unit-testable against synthetic rows.
 */
export function groupNotesByJobKey(
  notes: Array<{
    netId: string;
    jobId: string;
    note: string;
    validatedChartstring: string | null;
    linkToTimesheet: string | null;
    payPeriod: { name: string };
  }>,
): Record<string, TimesheetNoteView[]> {
  const map: Record<string, TimesheetNoteView[]> = {};
  for (const n of notes) {
    const key = noteKey(n.netId.toLowerCase(), n.jobId);
    (map[key] ??= []).push({
      note: n.note,
      validatedChartstring: n.validatedChartstring,
      linkToTimesheet: n.linkToTimesheet,
      payPeriodName: n.payPeriod.name,
    });
  }
  return map;
}

// ─── computeExpensesByProjectChartTerm ───────────────────────────────────────

export type ExpenseByProjectChart = {
  projectId: string | null;
  chartString: string;
  earnings: number;
};

/**
 * Budget seam: total earnings grouped by (projectId, chartString) for a term.
 * `projectId` is the attributed project id, or null for Core / Instructor /
 * External / unmatched lines. Earnings fan out to every attributed project
 * (shared jobs contribute to each), mirroring the collation attribution so the
 * two views agree.
 */
export async function computeExpensesByProjectChartTerm(
  termId: string,
): Promise<ExpenseByProjectChart[]> {
  const result = await getReconciliation(termId);

  // Sum earnings by (projectId, chartString). Project rows key on the attributed
  // project; Core/Instructor/External/unmatched all key projectId=null.
  const acc = new Map<string, ExpenseByProjectChart>();
  const add = (projectId: string | null, chartString: string, earnings: number) => {
    const key = `${projectId ?? ""}::${chartString}`;
    const existing = acc.get(key);
    if (existing) {
      existing.earnings += earnings;
    } else {
      acc.set(key, { projectId, chartString, earnings });
    }
  };

  // For per-(project, chartString) expense we need the chart string charged on
  // each job. Re-fetch entries once to attach chart strings to attributed pay.
  // Simpler + exact: recompute from the chart-string aggregation the collation
  // already produced, splitting each chart string's pay across the project(s)
  // it maps to (null when it maps to none).
  for (const cs of result.chartStrings) {
    if (cs.projects.length === 1) {
      add(cs.projects[0].id, cs.chartString, cs.totalPay);
    } else {
      // 0 projects (unmatched) or >1 (ambiguous): attribute to null so budget
      // shows it as an unassigned line rather than guessing.
      add(null, cs.chartString, cs.totalPay);
    }
  }

  return [...acc.values()];
}

// ─── buildExpectedAssignments ────────────────────────────────────────────────

export type ExpectedAssignment = PayrollRow;

/**
 * The expected staffing side for a term, reusing the payroll-export builders
 * (Project + Core + Instructor rows). Unlike the export CSV, this keeps every
 * candidate id so the reconcile view can join expected-vs-actual. `resolveJobCode`
 * is re-exported here for callers that need the raw lookup resolution.
 */
export async function buildExpectedAssignments(
  termId: string,
): Promise<ExpectedAssignment[]> {
  const [projectRows, coreCandidates, instructorCandidates] = await Promise.all([
    buildPayrollRows(termId),
    listAllCoreUserIds(termId),
    listAllInstructorUserIds(termId),
  ]);

  const [coreRows, instructorRows] = await Promise.all([
    buildCoreRows(termId, coreCandidates),
    buildInstructorRows(termId, instructorCandidates),
  ]);

  return [...projectRows, ...coreRows, ...instructorRows];
}

export { resolveJobCode };

// ─── internal helpers ────────────────────────────────────────────────────────

/** Whether `termId` is the currently-active term (contains today). */
async function isActiveTerm(termId: string): Promise<boolean> {
  const now = new Date();
  const term = await prisma.term.findUnique({
    where: { id: termId },
    select: { startDate: true, endDate: true },
  });
  if (!term) return false;
  return term.startDate <= now && now <= term.endDate;
}

/** All users with a Core assignment this term (expected-side, no selection UI). */
async function listAllCoreUserIds(termId: string): Promise<Set<string>> {
  const rows = await prisma.coreAssignment.findMany({
    where: { termId },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

/** All users with an Instructor assignment this term. */
async function listAllInstructorUserIds(termId: string): Promise<Set<string>> {
  const rows = await prisma.instructorAssignment.findMany({
    where: { termId },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}
