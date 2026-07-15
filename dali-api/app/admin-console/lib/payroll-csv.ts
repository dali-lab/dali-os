// Pure CSV parsing + validation for the TimesheetX exports (no Prisma).
//
// Two file kinds:
//   - Timesheet ("DetailsHoursWorked") — one row per approved shift.
//   - Notes ("Comments") — one row per per-timesheet note.
//
// Papa Parse handles the UTF-8 BOM (stripped from headers when header:true) and
// quoted fields. Trailing unnamed `Textbox*` columns in the real export are
// simply ignored — we only read the named columns below. Required headers are
// asserted up front (fail fast); every row that fails validation is collected
// into an error report instead of being silently coerced.

import Papa from "papaparse";
import { z } from "zod";

// ─── Header contracts (verified against the real export headers) ─────────────

// Real timesheet header row: Chart_String1,Pay_Period_Name,Employee_Name,
// Employee_NetID,Job_Title,JobID,Shift_Start_Time,Shift_End_Time,
// Total_Shift_Time,Hourly_Pay_Rate,Total_Earnings,Pay_Code,Department,
// Supervisor_First_Name,Supervisor_Last_Name,TS_Approver,Chart_String,
// Timesheet_Status,Overtime_Hours,Overtime_Earnings,Textbox7,…
//
// A couple of columns have drifted across export versions, so those accept an
// alias (first present wins): the pay period and the employee netId.
const PAY_PERIOD_ALIASES = ["Pay_Period_Name", "Pay_Period"] as const;
const NETID_ALIASES = ["Employee_NetID", "Net_Id"] as const;

const TIMESHEET_REQUIRED_HEADERS: ReadonlyArray<readonly string[]> = [
  PAY_PERIOD_ALIASES,
  ["Employee_Name"],
  NETID_ALIASES,
  ["Job_Title"],
  ["JobID"],
  ["Shift_Start_Time"],
  ["Shift_End_Time"],
  ["Total_Shift_Time"],
  ["Hourly_Pay_Rate"],
  ["Total_Earnings"],
  ["Pay_Code"],
  ["Department"],
  ["Chart_String"],
  ["Timesheet_Status"],
];

// Real notes header row: Pay_Period,Employee_First_Name1,Employee_Last_Name1,
// Net_Id,Job_Title,Job_ID,Department,Supervisor_Name,Supervisor_Email,
// Timesheet_Approver,Timesheet_Entry_Note1,Validated_Chartstring1,
// Link_to_Timesheet1
const NOTES_REQUIRED_HEADERS: ReadonlyArray<readonly string[]> = [
  ["Pay_Period"],
  ["Net_Id"],
  ["Job_ID"],
  ["Timesheet_Entry_Note1"],
];

// ─── Parsed row shapes ───────────────────────────────────────────────────────

export type ParsedTimesheetRow = {
  payPeriodName: string;
  employeeNetId: string; // lowercased
  employeeName: string;
  jobId: string; // kept as String (a category-level classifier, never math)
  jobTitle: string;
  chartString: string;
  shiftStartTime: string; // raw, identity/display only
  shiftEndTime: string;
  totalShiftTime: number;
  hourlyPayRate: number;
  totalEarnings: number;
  overtimeHours: number | null;
  overtimeEarnings: number | null;
  payCode: string;
  department: string;
  supervisorName: string;
  timesheetStatus: string;
};

export type ParsedNoteRow = {
  payPeriodName: string;
  netId: string; // lowercased
  jobId: string;
  note: string;
  validatedChartstring: string | null;
  linkToTimesheet: string | null;
};

export type RowError = {
  /** 1-based row number in the source file (header is row 1). */
  row: number;
  field: string;
  message: string;
};

export type ParseResult<T> = {
  rows: T[];
  errors: RowError[];
};

/** Thrown when required headers are missing — a whole-file, fail-fast error. */
export class CsvHeaderError extends Error {
  constructor(
    public readonly missing: string[],
    kind: string,
  ) {
    super(
      `Missing required ${kind} column(s): ${missing.join(", ")}. ` +
        `This does not look like a TimesheetX ${kind} export.`,
    );
    this.name = "CsvHeaderError";
  }
}

// ─── Field coercion helpers (record errors, never silently default) ──────────

/** Trim; blank dedupe-key fields become "" so the Postgres unique still dedupes. */
function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

// A numeric string with optional leading "$" and thousands separators.
// Blank → null; present-but-unparseable → NaN (so callers can tell the two
// apart: null may be legal for optional columns, NaN never is).
function parseNum(v: unknown): number | null {
  const s = str(v).replace(/[$,]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Required numeric: blank and unparseable both become NaN → schema error. */
function requiredNum(v: number | null): number {
  return v === null ? NaN : v;
}

/** First non-empty value among aliased columns. */
function aliased(raw: Record<string, string>, aliases: readonly string[]): string {
  for (const a of aliases) {
    const v = str(raw[a]);
    if (v !== "") return v;
  }
  return "";
}

function assertHeaders(
  fields: string[] | undefined,
  required: ReadonlyArray<readonly string[]>,
  kind: string,
): void {
  const present = new Set(fields ?? []);
  const missing = required
    .filter((aliases) => !aliases.some((h) => present.has(h)))
    .map((aliases) => aliases.join(" / "));
  if (missing.length > 0) throw new CsvHeaderError(missing, kind);
}

// zod schemas validate the already-coerced values so error messages are clean.
// NaN fails z.number(), which is how blank/unparseable required numerics and
// unparseable optional numerics surface as row errors.
const timesheetRowSchema = z.object({
  payPeriodName: z.string().min(1, "Pay period is required"),
  employeeNetId: z.string().min(1, "Employee NetID is required"),
  jobId: z.string().min(1, "JobID is required"),
  totalShiftTime: z.number("Total_Shift_Time must be a number"),
  hourlyPayRate: z.number("Hourly_Pay_Rate must be a number"),
  totalEarnings: z.number("Total_Earnings must be a number"),
  overtimeHours: z.number("Overtime_Hours must be a number or blank").nullable(),
  overtimeEarnings: z
    .number("Overtime_Earnings must be a number or blank")
    .nullable(),
});

/**
 * Parse a timesheet CSV. Throws CsvHeaderError if required headers are absent.
 * Per-row validation failures are collected in `errors`; only valid rows appear
 * in `rows`.
 */
export function parseTimesheetCsv(csvText: string): ParseResult<ParsedTimesheetRow> {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  assertHeaders(parsed.meta.fields, TIMESHEET_REQUIRED_HEADERS, "timesheet");

  const rows: ParsedTimesheetRow[] = [];
  const errors: RowError[] = [];

  parsed.data.forEach((raw, i) => {
    const rowNum = i + 2; // +1 header, +1 for 1-based

    // Combine the two supervisor name columns into the single stored field.
    const supervisorName = [
      str(raw["Supervisor_First_Name"]),
      str(raw["Supervisor_Last_Name"]),
    ]
      .filter(Boolean)
      .join(" ");

    const result = timesheetRowSchema.safeParse({
      payPeriodName: aliased(raw, PAY_PERIOD_ALIASES),
      employeeNetId: aliased(raw, NETID_ALIASES).toLowerCase(),
      jobId: str(raw["JobID"]),
      totalShiftTime: requiredNum(parseNum(raw["Total_Shift_Time"])),
      hourlyPayRate: requiredNum(parseNum(raw["Hourly_Pay_Rate"])),
      totalEarnings: requiredNum(parseNum(raw["Total_Earnings"])),
      // Optional: null (blank) is fine; NaN (unparseable) fails z.number().
      overtimeHours: parseNum(raw["Overtime_Hours"]),
      overtimeEarnings: parseNum(raw["Overtime_Earnings"]),
    });

    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          row: rowNum,
          field: String(issue.path[0] ?? ""),
          message: issue.message,
        });
      }
      return;
    }

    rows.push({
      ...result.data,
      employeeName: str(raw["Employee_Name"]),
      jobTitle: str(raw["Job_Title"]),
      chartString: str(raw["Chart_String"]),
      shiftStartTime: str(raw["Shift_Start_Time"]),
      shiftEndTime: str(raw["Shift_End_Time"]),
      payCode: str(raw["Pay_Code"]),
      department: str(raw["Department"]),
      supervisorName,
      timesheetStatus: str(raw["Timesheet_Status"]),
    });
  });

  return { rows, errors };
}

const noteRowSchema = z.object({
  payPeriodName: z.string().min(1, "Pay_Period is required"),
  netId: z.string().min(1, "Net_Id is required"),
  jobId: z.string().min(1, "Job_ID is required"),
  note: z.string().min(1, "Timesheet_Entry_Note1 is required"),
});

/**
 * Parse a notes CSV. Same contract as parseTimesheetCsv. Rows with an empty
 * note are recorded as errors and dropped — an empty note has nothing to store.
 */
export function parseNotesCsv(csvText: string): ParseResult<ParsedNoteRow> {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  assertHeaders(parsed.meta.fields, NOTES_REQUIRED_HEADERS, "notes");

  const rows: ParsedNoteRow[] = [];
  const errors: RowError[] = [];

  parsed.data.forEach((raw, i) => {
    const rowNum = i + 2;

    const validatedChartstring = str(raw["Validated_Chartstring1"]);
    const linkToTimesheet = str(raw["Link_to_Timesheet1"]);

    const candidate: ParsedNoteRow = {
      payPeriodName: str(raw["Pay_Period"]),
      netId: str(raw["Net_Id"]).toLowerCase(),
      jobId: str(raw["Job_ID"]),
      note: str(raw["Timesheet_Entry_Note1"]),
      validatedChartstring: validatedChartstring || null,
      linkToTimesheet: linkToTimesheet || null,
    };

    const result = noteRowSchema.safeParse(candidate);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          row: rowNum,
          field: String(issue.path[0] ?? ""),
          message: issue.message,
        });
      }
      return;
    }

    rows.push(candidate);
  });

  return { rows, errors };
}
