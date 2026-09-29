import type { Route } from "./+types/admin.payroll.upload";
import { requireAuth, forbidden } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { MAX_UPLOAD_BYTES, fileMatchesAccept } from "~/lib/file-validation";
import {
  importPayrollCsvs,
  PayrollImportError,
} from "~/admin/lib/payroll-import.server";
import type { PayrollUploadError } from "~/admin/lib/payroll-import.server";

// Resource route — action-only, registered OUTSIDE the app layout. Accepts a
// multipart form with a required `timesheet` .csv and an optional `notes` .csv,
// ingests the timesheet first (notes attach to already-imported periods), and
// returns a JSON import summary the upload modal renders. PII rule: never log
// CSV contents.

// The result types live with the shared import (the MCP tool returns them too);
// re-exported here because the upload modal imports them from this route.
export type {
  PayrollUploadResult,
  PayrollUploadError,
} from "~/admin/lib/payroll-import.server";

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

  try {
    const result = await importPayrollCsvs({
      timesheet: { text: await timesheet.text(), fileName: timesheet.name },
      notes: hasNotes
        ? { text: await (notes as File).text(), fileName: (notes as File).name }
        : null,
      uploadedById: auth.user.sub,
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof PayrollImportError) return jsonError(e.message, 400);
    throw e;
  }
}
