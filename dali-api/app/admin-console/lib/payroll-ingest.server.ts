// Ingestion server module: persist parsed TimesheetX rows with idempotent
// replace semantics, per pay period, inside a transaction. Also ingests the
// Notes CSV. Nothing is ever "updated" in place — each import deletes the prior
// rows for the period and re-creates, recording created / skipped-duplicate /
// deleted-prior counts in a TimesheetImport audit row.

import { createHash } from "node:crypto";
import { prisma } from "~/lib/db";
import {
  parsePayPeriodName,
  matchTermForPeriod,
  type TermWindow,
} from "~/admin-console/lib/pay-period";
import type {
  ParsedTimesheetRow,
  ParsedNoteRow,
} from "~/admin-console/lib/payroll-csv";

export type PayPeriodImportResult = {
  payPeriodId: string;
  payPeriodName: string;
  termId: string | null;
  rowsCreated: number;
  rowsSkippedDuplicates: number;
  rowsDeletedPrior: number;
};

export type TimesheetIngestResult = {
  periods: PayPeriodImportResult[];
  /** Period-name strings that failed pay-period validation (skipped). */
  invalidPeriods: string[];
};

export type NotesIngestResult = {
  periods: Array<{
    payPeriodId: string;
    payPeriodName: string;
    rowsCreated: number;
    rowsSkippedDuplicates: number;
    rowsDeletedPrior: number;
  }>;
  /** Note rows whose pay period doesn't exist yet (skipped). */
  skippedUnknownPeriods: number;
  invalidPeriods: string[];
};

function noteHash(note: string): string {
  return createHash("sha256").update(note).digest("hex");
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = map.get(k) ?? [];
    arr.push(r);
    map.set(k, arr);
  }
  return map;
}

// ─── Timesheet ingestion ─────────────────────────────────────────────────────

/**
 * Ingest parsed timesheet rows. Groups by pay-period label, validates each
 * period, and for each valid period runs one transaction:
 *   payPeriod.upsert → deleteMany(prior entries) → createMany(skipDuplicates)
 *   → TimesheetImport audit row.
 *
 * Idempotent: re-running the same file yields rowsCreated = the row count with
 * rowsDeletedPrior = the same (replace), so period totals never drift.
 */
export async function ingestTimesheet(
  rows: ParsedTimesheetRow[],
  meta: { fileName: string; uploadedById: string },
): Promise<TimesheetIngestResult> {
  const terms = await loadTermWindows();
  const byPeriod = groupBy(rows, (r) => r.payPeriodName);

  const periods: PayPeriodImportResult[] = [];
  const invalidPeriods: string[] = [];

  for (const [rawName, periodRows] of byPeriod) {
    const parsed = parsePayPeriodName(rawName);
    if (!parsed) {
      invalidPeriods.push(rawName);
      continue;
    }
    const termId = matchTermForPeriod(parsed, terms);

    const result = await prisma.$transaction(async (tx) => {
      const payPeriod = await tx.payPeriod.upsert({
        where: { name: parsed.name },
        update: { startDate: parsed.startDate, endDate: parsed.endDate },
        create: {
          name: parsed.name,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          termId,
        },
      });

      const deleted = await tx.timesheetEntry.deleteMany({
        where: { payPeriodId: payPeriod.id },
      });

      const data = periodRows.map((r) => ({
        payPeriodId: payPeriod.id,
        employeeNetId: r.employeeNetId,
        employeeName: r.employeeName,
        jobId: r.jobId,
        jobTitle: r.jobTitle,
        chartString: r.chartString,
        shiftStartTime: r.shiftStartTime,
        shiftEndTime: r.shiftEndTime,
        totalShiftTime: r.totalShiftTime,
        hourlyPayRate: r.hourlyPayRate,
        totalEarnings: r.totalEarnings,
        overtimeHours: r.overtimeHours,
        overtimeEarnings: r.overtimeEarnings,
        payCode: r.payCode,
        department: r.department,
        supervisorName: r.supervisorName,
        timesheetStatus: r.timesheetStatus,
      }));

      const created = await tx.timesheetEntry.createMany({
        data,
        skipDuplicates: true,
      });

      await tx.timesheetImport.create({
        data: {
          fileName: meta.fileName,
          kind: "Timesheet",
          payPeriodId: payPeriod.id,
          rowsCreated: created.count,
          rowsSkippedDuplicates: data.length - created.count,
          rowsDeletedPrior: deleted.count,
          uploadedById: meta.uploadedById,
        },
      });

      return {
        payPeriodId: payPeriod.id,
        payPeriodName: payPeriod.name,
        termId,
        rowsCreated: created.count,
        rowsSkippedDuplicates: data.length - created.count,
        rowsDeletedPrior: deleted.count,
      } satisfies PayPeriodImportResult;
    });

    periods.push(result);
  }

  return { periods, invalidPeriods };
}

// ─── Notes ingestion ─────────────────────────────────────────────────────────

/**
 * Ingest parsed note rows. Notes attach to already-imported pay periods —
 * rows whose period doesn't exist are skipped (counted). Per existing period:
 * deleteMany(prior notes) → createMany(skipDuplicates on the noteHash unique) →
 * TimesheetImport(kind=Notes) audit row.
 */
export async function ingestNotes(
  rows: ParsedNoteRow[],
  meta: { fileName: string; uploadedById: string },
): Promise<NotesIngestResult> {
  const byPeriod = groupBy(rows, (r) => r.payPeriodName);

  const periods: NotesIngestResult["periods"] = [];
  const invalidPeriods: string[] = [];
  let skippedUnknownPeriods = 0;

  for (const [rawName, periodRows] of byPeriod) {
    const parsed = parsePayPeriodName(rawName);
    if (!parsed) {
      invalidPeriods.push(rawName);
      continue;
    }

    const payPeriod = await prisma.payPeriod.findUnique({
      where: { name: parsed.name },
      select: { id: true, name: true },
    });
    if (!payPeriod) {
      skippedUnknownPeriods += periodRows.length;
      continue;
    }

    const result = await prisma.$transaction(async (tx) => {
      const deleted = await tx.timesheetNote.deleteMany({
        where: { payPeriodId: payPeriod.id },
      });

      const data = periodRows.map((r) => ({
        payPeriodId: payPeriod.id,
        netId: r.netId,
        jobId: r.jobId,
        note: r.note,
        noteHash: noteHash(r.note),
        validatedChartstring: r.validatedChartstring,
        linkToTimesheet: r.linkToTimesheet,
      }));

      const created = await tx.timesheetNote.createMany({
        data,
        skipDuplicates: true,
      });

      await tx.timesheetImport.create({
        data: {
          fileName: meta.fileName,
          kind: "Notes",
          payPeriodId: payPeriod.id,
          rowsCreated: created.count,
          rowsSkippedDuplicates: data.length - created.count,
          rowsDeletedPrior: deleted.count,
          uploadedById: meta.uploadedById,
        },
      });

      return {
        payPeriodId: payPeriod.id,
        payPeriodName: payPeriod.name,
        rowsCreated: created.count,
        rowsSkippedDuplicates: data.length - created.count,
        rowsDeletedPrior: deleted.count,
      };
    });

    periods.push(result);
  }

  return { periods, invalidPeriods, skippedUnknownPeriods };
}

// ─── Delete & re-import ──────────────────────────────────────────────────────

/**
 * Explicit delete of a pay period and all its children (entries/notes/imports
 * cascade via FK). The delete-and-re-import path for upstream corrections that
 * remove rows — a silent replace can't shrink a period, this can.
 */
export async function deletePayPeriod(payPeriodId: string): Promise<void> {
  await prisma.payPeriod.delete({ where: { id: payPeriodId } });
}

// ─── internal ────────────────────────────────────────────────────────────────

async function loadTermWindows(): Promise<TermWindow[]> {
  const terms = await prisma.term.findMany({
    select: { id: true, startDate: true, endDate: true },
  });
  return terms.map((t) => ({
    id: t.id,
    startDate: t.startDate,
    endDate: t.endDate,
  }));
}
