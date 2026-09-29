import { describe, it, expect, beforeEach, vi } from "vitest";

const { CsvHeaderError } = vi.hoisted(() => ({
  CsvHeaderError: class CsvHeaderError extends Error {},
}));

vi.mock("~/admin/lib/payroll-csv", () => ({
  parseTimesheetCsv: vi.fn(),
  parseNotesCsv: vi.fn(),
  CsvHeaderError,
}));
vi.mock("~/admin/lib/payroll-ingest.server", () => ({
  ingestTimesheet: vi.fn(),
  ingestNotes: vi.fn(),
}));

import { parseTimesheetCsv, parseNotesCsv } from "~/admin/lib/payroll-csv";
import { ingestTimesheet, ingestNotes } from "~/admin/lib/payroll-ingest.server";
import { importPayrollCsvs, PayrollImportError } from "~/admin/lib/payroll-import.server";

const TIMESHEET = { text: "timesheet", fileName: "t.csv" };
const NOTES = { text: "notes", fileName: "n.csv" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseTimesheetCsv).mockReturnValue({ rows: [], errors: [] } as never);
  vi.mocked(parseNotesCsv).mockReturnValue({ rows: [], errors: [] } as never);
  vi.mocked(ingestTimesheet).mockResolvedValue({
    periods: [
      { payPeriodName: "P1", termId: "t1", rowsCreated: 3, rowsSkippedDuplicates: 0, rowsDeletedPrior: 1, extra: "x" },
    ],
    invalidPeriods: [],
  } as never);
  vi.mocked(ingestNotes).mockResolvedValue({
    periods: [{}],
    skippedUnknownPeriods: 0,
    invalidPeriods: [],
  } as never);
});

describe("importPayrollCsvs", () => {
  it("ingests nothing when the timesheet header is wrong", async () => {
    vi.mocked(parseTimesheetCsv).mockImplementation(() => {
      throw new CsvHeaderError("Missing required column: Pay_Period_Name");
    });
    await expect(importPayrollCsvs({ timesheet: TIMESHEET, uploadedById: "u1" })).rejects.toEqual(
      new PayrollImportError("Missing required column: Pay_Period_Name"),
    );
    expect(ingestTimesheet).not.toHaveBeenCalled();
  });

  it("keeps the ingested timesheet when the notes header is wrong, and says so", async () => {
    // Same as the upload page always did: notes attach to periods the
    // timesheet already imported, so a bad notes file fails after that commit.
    vi.mocked(parseNotesCsv).mockImplementation(() => {
      throw new CsvHeaderError("Missing required column: NetID");
    });
    await expect(
      importPayrollCsvs({ timesheet: TIMESHEET, notes: NOTES, uploadedById: "u1" }),
    ).rejects.toThrow("Missing required column: NetID");
    expect(ingestTimesheet).toHaveBeenCalledWith([], { fileName: "t.csv", uploadedById: "u1" });
    expect(ingestNotes).not.toHaveBeenCalled();
  });

  it("returns the page's summary shape", async () => {
    const out = await importPayrollCsvs({ timesheet: TIMESHEET, notes: NOTES, uploadedById: "u1" });
    expect(out).toEqual({
      ok: true,
      timesheet: {
        periods: [
          { payPeriodName: "P1", termId: "t1", rowsCreated: 3, rowsSkippedDuplicates: 0, rowsDeletedPrior: 1 },
        ],
        invalidPeriods: [],
        rowErrors: [],
      },
      notes: { periodsUpdated: 1, skippedUnknownPeriods: 0, invalidPeriods: [], rowErrors: [] },
    });
  });
});
