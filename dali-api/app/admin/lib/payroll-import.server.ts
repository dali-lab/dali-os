// The payroll CSV import, shared by the Admin → Payroll upload page and the
// MCP import tool: parse and ingest the timesheet, then the optional notes
// (they attach to the periods the timesheet just imported). One implementation
// so the two entry points can't import the same file differently. PII rule:
// never log CSV contents.

import {
  parseTimesheetCsv,
  parseNotesCsv,
  CsvHeaderError,
  type RowError,
} from "~/admin/lib/payroll-csv";
import { ingestTimesheet, ingestNotes } from "~/admin/lib/payroll-ingest.server";

/** What an import reports back — rendered by the upload modal, returned by the
 *  MCP tool. */
export type PayrollUploadResult = {
  ok: true;
  timesheet: {
    periods: Array<{
      payPeriodName: string;
      termId: string | null;
      rowsCreated: number;
      rowsSkippedDuplicates: number;
      rowsDeletedPrior: number;
    }>;
    invalidPeriods: string[];
    rowErrors: RowError[];
  };
  notes: {
    periodsUpdated: number;
    skippedUnknownPeriods: number;
    invalidPeriods: string[];
    rowErrors: RowError[];
  } | null;
};

export type PayrollUploadError = { ok: false; error: string };

/** A whole-file failure the caller should show as-is (a 400). */
export class PayrollImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollImportError";
  }
}

export type PayrollCsv = { text: string; fileName: string };

export async function importPayrollCsvs(input: {
  timesheet: PayrollCsv;
  notes?: PayrollCsv | null;
  uploadedById: string;
}): Promise<PayrollUploadResult> {
  // Timesheet first: a missing header is a whole-file failure with a clear
  // message, and nothing is ingested.
  let timesheetParse;
  try {
    timesheetParse = parseTimesheetCsv(input.timesheet.text);
  } catch (e) {
    if (e instanceof CsvHeaderError) throw new PayrollImportError(e.message);
    throw new PayrollImportError("Could not parse the timesheet CSV.");
  }

  const timesheetResult = await ingestTimesheet(timesheetParse.rows, {
    fileName: input.timesheet.fileName,
    uploadedById: input.uploadedById,
  });

  let notesResult: PayrollUploadResult["notes"] = null;
  if (input.notes) {
    let notesParse;
    try {
      notesParse = parseNotesCsv(input.notes.text);
    } catch (e) {
      if (e instanceof CsvHeaderError) throw new PayrollImportError(e.message);
      throw new PayrollImportError("Could not parse the notes CSV.");
    }
    const ingested = await ingestNotes(notesParse.rows, {
      fileName: input.notes.fileName,
      uploadedById: input.uploadedById,
    });
    notesResult = {
      periodsUpdated: ingested.periods.length,
      skippedUnknownPeriods: ingested.skippedUnknownPeriods,
      invalidPeriods: ingested.invalidPeriods,
      rowErrors: notesParse.errors,
    };
  }

  return {
    ok: true,
    timesheet: {
      periods: timesheetResult.periods.map((p) => ({
        payPeriodName: p.payPeriodName,
        termId: p.termId,
        rowsCreated: p.rowsCreated,
        rowsSkippedDuplicates: p.rowsSkippedDuplicates,
        rowsDeletedPrior: p.rowsDeletedPrior,
      })),
      invalidPeriods: timesheetResult.invalidPeriods,
      rowErrors: timesheetParse.errors,
    },
    notes: notesResult,
  };
}
