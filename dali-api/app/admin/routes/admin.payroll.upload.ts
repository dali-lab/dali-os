import type { Route } from "./+types/admin.payroll.upload";
import { requireAuth, forbidden } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { MAX_UPLOAD_BYTES, fileMatchesAccept } from "~/lib/file-validation";
import {
  parseTimesheetCsv,
  parseNotesCsv,
  CsvHeaderError,
  type RowError,
} from "~/admin/lib/payroll-csv";
import {
  ingestTimesheet,
  ingestNotes,
} from "~/admin/lib/payroll-ingest.server";

// Resource route — action-only, registered OUTSIDE the app layout. Accepts a
// multipart form with a required `timesheet` .csv and an optional `notes` .csv,
// ingests the timesheet first (notes attach to already-imported periods), and
// returns a JSON import summary the upload modal renders. PII rule: never log
// CSV contents.

/** Shape returned to the upload modal (PR4/PR5 may reuse this contract). */
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

function jsonError(message: string, status: number): Response {
  return Response.json({ ok: false, error: message } satisfies PayrollUploadError, {
    status,
  });
}

export async function action({ request }: Route.ActionArgs): Promise<Response> {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isAdmin(auth.user.sub))) return forbidden(request);

  // request.formData() buffers the whole body in memory, so cap it before the
  // parse. Content-Length is advisory (a client can lie) but catches the
  // common oversized-file case cheaply.
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_UPLOAD_BYTES) {
    return jsonError("File too large (10 MB max).", 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Could not read the upload. Try again.", 400);
  }

  const timesheet = form.get("timesheet");
  if (!(timesheet instanceof File) || timesheet.size === 0) {
    return jsonError("A timesheet CSV is required.", 400);
  }
  if (timesheet.size > MAX_UPLOAD_BYTES) {
    return jsonError("File too large (10 MB max).", 413);
  }
  if (!fileMatchesAccept(timesheet.name, timesheet.type, ".csv")) {
    return jsonError("The timesheet must be a .csv file.", 400);
  }

  const notes = form.get("notes");
  const hasNotes = notes instanceof File && notes.size > 0;
  if (hasNotes) {
    if ((notes as File).size > MAX_UPLOAD_BYTES) {
      return jsonError("File too large (10 MB max).", 413);
    }
    if (!fileMatchesAccept((notes as File).name, (notes as File).type, ".csv")) {
      return jsonError("The notes file must be a .csv file.", 400);
    }
  }

  // Parse timesheet BEFORE notes (notes attach to imported periods). A missing
  // header is a whole-file failure → 400 with a clear message.
  let timesheetParse;
  try {
    timesheetParse = parseTimesheetCsv(await timesheet.text());
  } catch (e) {
    if (e instanceof CsvHeaderError) return jsonError(e.message, 400);
    return jsonError("Could not parse the timesheet CSV.", 400);
  }

  const timesheetResult = await ingestTimesheet(timesheetParse.rows, {
    fileName: timesheet.name,
    uploadedById: auth.user.sub,
  });

  let notesResult: PayrollUploadResult["notes"] = null;
  if (hasNotes) {
    let notesParse;
    try {
      notesParse = parseNotesCsv(await (notes as File).text());
    } catch (e) {
      if (e instanceof CsvHeaderError) return jsonError(e.message, 400);
      return jsonError("Could not parse the notes CSV.", 400);
    }
    const ingested = await ingestNotes(notesParse.rows, {
      fileName: (notes as File).name,
      uploadedById: auth.user.sub,
    });
    notesResult = {
      periodsUpdated: ingested.periods.length,
      skippedUnknownPeriods: ingested.skippedUnknownPeriods,
      invalidPeriods: ingested.invalidPeriods,
      rowErrors: notesParse.errors,
    };
  }

  return Response.json({
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
  } satisfies PayrollUploadResult);
}
