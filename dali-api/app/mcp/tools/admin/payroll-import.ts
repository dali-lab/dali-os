// MCP `create_payroll_csv_upload` + `import_payroll_csvs` — the Admin → Payroll
// (Reconcile) upload, from an agent. Same two-step shape as the project-file
// upload: the CSV goes straight to S3 by presigned POST, never through a tool
// call (a TimesheetX export is thousands of rows of student pay), and the
// import runs the same code as the page's Upload button (importPayrollCsvs).
// The uploaded files are deleted after the import — the page never stores
// them, so neither does this.
//
// Admin-only, like the page, and mcp:admin scope.

import { isAdmin } from "~/lib/roles";
import {
  deleteObject,
  getObjectBytes,
  getUploadPost,
  headObject,
  isS3Configured,
} from "~/lib/s3";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "~/lib/file-validation";
import {
  importPayrollCsvs,
  PayrollImportError,
  type PayrollCsv,
} from "~/admin/lib/payroll-import.server";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminInvalidError as McpInvalidError,
  AdminNotFoundError as McpNotFoundError,
} from "./errors";
import { curlCommand } from "../presigned-upload";

const PREFIX = "uploads/payroll-imports/";
// 15 minutes: the agent has to turn the response into a curl call first.
const EXPIRES_IN = 900;

export const CREATE_PAYROLL_CSV_UPLOAD_TOOL = {
  name: "create_payroll_csv_upload",
  description: `Start uploading a payroll CSV for Admin → Payroll reconciliation: the TimesheetX timesheet export (kind "timesheet") or the optional notes CSV (kind "notes"). Returns a presigned S3 POST and a ready curl command for a POSIX shell: run it with the local file path, expect a final line of HTTP 204, then call import_payroll_csvs with the key(s). Max ${MAX_UPLOAD_LABEL}; the link expires after 15 minutes. Admin-only.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      kind: {
        type: "string",
        enum: ["timesheet", "notes"],
        description: "Which file this is. Import needs a timesheet; notes are optional.",
      },
      fileName: {
        type: "string",
        minLength: 1,
        maxLength: 255,
        description: "The CSV's file name, e.g. 'TimesheetX 09-13-2026.csv'. Must end in .csv.",
      },
    },
    required: ["kind", "fileName"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

export const IMPORT_PAYROLL_CSVS_TOOL = {
  name: "import_payroll_csvs",
  description:
    "Import payroll CSVs uploaded with create_payroll_csv_upload into Admin → Payroll — the same import as the page's Upload button. The timesheet is required; notes are optional and attach to the pay periods the timesheet imports. Re-importing a pay period replaces its rows. Both uploaded files are deleted afterwards, whether or not the import succeeds. Returns the import summary: per-period rows created, duplicates skipped, prior rows replaced, invalid periods, and per-row errors. Admin-only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      timesheetKey: {
        type: "string",
        minLength: 1,
        maxLength: 1024,
        description: "Key returned by create_payroll_csv_upload for the timesheet.",
      },
      notesKey: {
        type: "string",
        minLength: 1,
        maxLength: 1024,
        description: "Key returned by create_payroll_csv_upload for the notes CSV (optional).",
      },
    },
    required: ["timesheetKey"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

async function requireAdmin(callerId: string): Promise<void> {
  if (!(await isAdmin(callerId))) {
    throw new McpForbiddenError("Only admins can import payroll.");
  }
}

export async function runCreatePayrollCsvUpload(
  callerId: string,
  input: { kind: "timesheet" | "notes"; fileName: string },
) {
  await requireAdmin(callerId);

  const fileName = input.fileName.trim();
  if (!/\.csv$/i.test(fileName)) {
    throw new McpInvalidError("The file must be a .csv.");
  }
  if (!isS3Configured()) {
    throw new McpInvalidError("File storage is not configured in this environment");
  }

  const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  const key = `${PREFIX}${crypto.randomUUID()}-${safeName}`;
  const { url, fields } = await getUploadPost(key, "text/csv", {
    maxBytes: MAX_UPLOAD_BYTES,
    expiresIn: EXPIRES_IN,
  });

  return {
    kind: input.kind,
    key,
    uploadUrl: url,
    fields,
    maxBytes: MAX_UPLOAD_BYTES,
    expiresAt: new Date(Date.now() + EXPIRES_IN * 1000).toISOString(),
    curl: curlCommand(url, fields, safeName),
    next: "Replace /path/to/… with the local file path and run the curl command; a final line of HTTP 204 means stored. Then call import_payroll_csvs with this key (as timesheetKey or notesKey).",
  };
}

/** Only keys this tool minted: the prefix plus one segment. */
function assertPayrollKey(key: string, label: string): void {
  const rest = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : "";
  if (rest === "" || rest.includes("/")) {
    throw new McpInvalidError(
      `${label} is not a payroll upload — pass the key create_payroll_csv_upload returned`,
    );
  }
}

async function readUploadedCsv(key: string): Promise<PayrollCsv> {
  let stored: Awaited<ReturnType<typeof headObject>>;
  try {
    stored = await headObject(key);
  } catch (err) {
    throw new McpInvalidError(
      err instanceof Error && /not configured/.test(err.message)
        ? "File storage is not configured in this environment"
        : // Without s3:ListBucket, S3 answers a missing key with 403, not 404.
          `Could not find ${key} in storage. Make sure the POST from create_payroll_csv_upload returned HTTP 204, then retry.`,
    );
  }
  if (!stored) {
    throw new McpNotFoundError(
      `Nothing has been uploaded at ${key}. Run the POST from create_payroll_csv_upload first (it returns HTTP 204 on success); the link expires 15 minutes after it was created.`,
    );
  }
  if (stored.sizeBytes > MAX_UPLOAD_BYTES) {
    throw new McpInvalidError(`File too large (${MAX_UPLOAD_LABEL} max).`);
  }

  const { body } = await getObjectBytes(key);
  return {
    // TextDecoder drops a UTF-8 BOM, as File.text() does on the upload page —
    // a raw Buffer string would leave it glued to the first header.
    text: new TextDecoder().decode(body),
    fileName: key.slice(PREFIX.length).replace(/^[0-9a-f-]{36}-/i, ""),
  };
}

export async function runImportPayrollCsvs(
  callerId: string,
  input: { timesheetKey: string; notesKey?: string },
) {
  await requireAdmin(callerId);

  const timesheetKey = input.timesheetKey.trim();
  const notesKey = input.notesKey?.trim() || null;
  assertPayrollKey(timesheetKey, "timesheetKey");
  if (notesKey) {
    assertPayrollKey(notesKey, "notesKey");
    if (notesKey === timesheetKey) {
      throw new McpInvalidError("timesheetKey and notesKey must be different uploads.");
    }
  }

  try {
    const timesheet = await readUploadedCsv(timesheetKey);
    const notes = notesKey ? await readUploadedCsv(notesKey) : null;
    return await importPayrollCsvs({ timesheet, notes, uploadedById: callerId });
  } catch (err) {
    if (err instanceof PayrollImportError) throw new McpInvalidError(err.message);
    throw err;
  } finally {
    // Student pay data: gone once read, however the import went.
    await Promise.allSettled(
      [timesheetKey, notesKey].filter((k): k is string => !!k).map((k) => deleteObject(k)),
    );
  }
}
