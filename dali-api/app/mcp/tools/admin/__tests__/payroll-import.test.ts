import { describe, it, expect, beforeEach, vi } from "vitest";

const { PayrollImportError } = vi.hoisted(() => ({
  PayrollImportError: class PayrollImportError extends Error {},
}));

vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn() }));
vi.mock("~/lib/s3", () => ({
  deleteObject: vi.fn(),
  getObjectBytes: vi.fn(),
  getUploadPost: vi.fn(),
  headObject: vi.fn(),
  isS3Configured: vi.fn(() => true),
}));
vi.mock("~/admin/lib/payroll-import.server", () => ({
  importPayrollCsvs: vi.fn(),
  PayrollImportError,
}));

import { isAdmin } from "~/lib/roles";
import { deleteObject, getObjectBytes, getUploadPost, headObject } from "~/lib/s3";
import { importPayrollCsvs } from "~/admin/lib/payroll-import.server";
import { MAX_UPLOAD_BYTES } from "~/lib/file-validation";
import {
  runCreatePayrollCsvUpload,
  runImportPayrollCsvs,
} from "~/mcp/tools/admin/payroll-import";

const TS_KEY = "uploads/payroll-imports/0b5e8f3c-1a2b-4c3d-8e9f-0123456789ab-TimesheetX_09-13.csv";
const NOTES_KEY = "uploads/payroll-imports/1c6f9a4d-2b3c-4d5e-9f0a-123456789abc-notes.csv";
const SUMMARY = { ok: true, timesheet: { periods: [], invalidPeriods: [], rowErrors: [] }, notes: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAdmin).mockResolvedValue(true);
  vi.mocked(getUploadPost).mockResolvedValue({
    url: "https://bucket.s3.amazonaws.com/",
    fields: { key: "k", "Content-Type": "text/csv" },
  });
  vi.mocked(headObject).mockResolvedValue({ sizeBytes: 1200, contentType: "text/csv" });
  vi.mocked(getObjectBytes).mockResolvedValue({ body: Buffer.from("Pay_Period_Name\n"), contentType: "text/csv" });
  vi.mocked(importPayrollCsvs).mockResolvedValue(SUMMARY as never);
  vi.mocked(deleteObject).mockResolvedValue();
});

describe("create_payroll_csv_upload", () => {
  it("is admin-only", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    await expect(
      runCreatePayrollCsvUpload("u1", { kind: "timesheet", fileName: "t.csv" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(getUploadPost).not.toHaveBeenCalled();
  });

  it("refuses anything that isn't a .csv", async () => {
    await expect(
      runCreatePayrollCsvUpload("u1", { kind: "timesheet", fileName: "t.xlsx" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("signs a 10 MB, 15-minute text/csv policy for a server-chosen key", async () => {
    const res = await runCreatePayrollCsvUpload("u1", {
      kind: "timesheet",
      fileName: "TimesheetX 09-13.csv",
    });
    expect(res.key).toMatch(/^uploads\/payroll-imports\/[0-9a-f-]{36}-TimesheetX_09-13\.csv$/);
    expect(getUploadPost).toHaveBeenCalledWith(res.key, "text/csv", {
      maxBytes: MAX_UPLOAD_BYTES,
      expiresIn: 900,
    });
    expect(res.curl.endsWith("-F 'file=@/path/to/TimesheetX_09-13.csv'")).toBe(true);
  });
});

describe("import_payroll_csvs", () => {
  it("is admin-only and touches nothing otherwise", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    await expect(runImportPayrollCsvs("u1", { timesheetKey: TS_KEY })).rejects.toMatchObject({
      status: 403,
    });
    expect(importPayrollCsvs).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it.each([
    ["another upload", "uploads/project-files/p1/x.csv"],
    ["a nested path", "uploads/payroll-imports/a/b.csv"],
    ["the bare prefix", "uploads/payroll-imports/"],
  ])("refuses %s as a key", async (_label, timesheetKey) => {
    await expect(runImportPayrollCsvs("u1", { timesheetKey })).rejects.toMatchObject({ status: 400 });
    expect(headObject).not.toHaveBeenCalled();
  });

  it("runs the page's import on both files and returns its summary", async () => {
    vi.mocked(getObjectBytes)
      .mockResolvedValueOnce({ body: Buffer.from("timesheet csv"), contentType: "text/csv" })
      .mockResolvedValueOnce({ body: Buffer.from("notes csv"), contentType: "text/csv" });

    const out = await runImportPayrollCsvs("u1", { timesheetKey: TS_KEY, notesKey: NOTES_KEY });

    expect(out).toBe(SUMMARY);
    expect(importPayrollCsvs).toHaveBeenCalledWith({
      timesheet: { text: "timesheet csv", fileName: "TimesheetX_09-13.csv" },
      notes: { text: "notes csv", fileName: "notes.csv" },
      uploadedById: "u1",
    });
  });

  it("strips a UTF-8 BOM the way the upload page's File.text() does", async () => {
    vi.mocked(getObjectBytes).mockResolvedValueOnce({
      body: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Pay_Period_Name,Employee_NetID\n")]),
      contentType: "text/csv",
    });
    await runImportPayrollCsvs("u1", { timesheetKey: TS_KEY });
    expect(vi.mocked(importPayrollCsvs).mock.calls[0][0].timesheet.text).toBe(
      "Pay_Period_Name,Employee_NetID\n",
    );
  });

  it("deletes both uploads after a successful import", async () => {
    await runImportPayrollCsvs("u1", { timesheetKey: TS_KEY, notesKey: NOTES_KEY });
    expect(deleteObject).toHaveBeenCalledWith(TS_KEY);
    expect(deleteObject).toHaveBeenCalledWith(NOTES_KEY);
  });

  it("still deletes the uploads when the file is rejected, and reports why", async () => {
    vi.mocked(importPayrollCsvs).mockRejectedValue(
      new PayrollImportError("Missing required column: Pay_Period_Name"),
    );
    await expect(runImportPayrollCsvs("u1", { timesheetKey: TS_KEY })).rejects.toMatchObject({
      status: 400,
      message: "Missing required column: Pay_Period_Name",
    });
    expect(deleteObject).toHaveBeenCalledWith(TS_KEY);
  });

  it("says to run the POST first when nothing was uploaded", async () => {
    vi.mocked(headObject).mockResolvedValue(null);
    await expect(runImportPayrollCsvs("u1", { timesheetKey: TS_KEY })).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining("HTTP 204"),
    });
    expect(importPayrollCsvs).not.toHaveBeenCalled();
  });

  it("refuses an object over the cap without reading it", async () => {
    vi.mocked(headObject).mockResolvedValue({ sizeBytes: MAX_UPLOAD_BYTES + 1, contentType: "text/csv" });
    await expect(runImportPayrollCsvs("u1", { timesheetKey: TS_KEY })).rejects.toMatchObject({ status: 400 });
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("refuses the same key as both files", async () => {
    await expect(
      runImportPayrollCsvs("u1", { timesheetKey: TS_KEY, notesKey: TS_KEY }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
