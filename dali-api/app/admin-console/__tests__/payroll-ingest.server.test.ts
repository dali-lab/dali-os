import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  ingestTimesheet,
  ingestNotes,
  deletePayPeriod,
} from "~/admin-console/lib/payroll-ingest.server";
import type {
  ParsedTimesheetRow,
  ParsedNoteRow,
} from "~/admin-console/lib/payroll-csv";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };

const PERIOD = "09/14/2025 - 09/27/2025";

// Synthetic rows only — famous computer scientists, f00fake* netids.
function tsRow(o: Partial<ParsedTimesheetRow> = {}): ParsedTimesheetRow {
  return {
    payPeriodName: PERIOD,
    employeeNetId: "f00fake1",
    employeeName: "Lovelace, Ada",
    jobId: "4834",
    jobTitle: "DALI Lab Student Employee",
    chartString: "18.722.161028.128512.4000",
    shiftStartTime: "9/18/2025 4:00:00 PM",
    shiftEndTime: "9/18/2025 6:00:00 PM",
    totalShiftTime: 2,
    hourlyPayRate: 16.25,
    totalEarnings: 32.5,
    overtimeHours: null,
    overtimeEarnings: null,
    payCode: "Regular Hours",
    department: "Magnuson Center",
    supervisorName: "Grace Hopper",
    timesheetStatus: "Finalized",
    ...o,
  };
}

function noteRow(o: Partial<ParsedNoteRow> = {}): ParsedNoteRow {
  return {
    payPeriodName: PERIOD,
    netId: "f00fake1",
    jobId: "4834",
    note: "Analytical engine maintenance",
    validatedChartstring: "18.722.161028.128512.4000",
    linkToTimesheet: null,
    ...o,
  };
}

const META = { fileName: "timesheet.csv", uploadedById: "user-admin-1" };

const FALL_TERM = {
  id: "term-25f",
  startDate: new Date(Date.UTC(2025, 8, 15)),
  endDate: new Date(Date.UTC(2025, 10, 25)),
};

beforeEach(() => {
  vi.resetAllMocks();
  // Repo convention: $transaction is a bare vi.fn() in the shared mock — give
  // it the interactive-callback implementation per test file.
  mockPrisma.$transaction.mockImplementation(async (cb: unknown) =>
    typeof cb === "function"
      ? (cb as (tx: unknown) => Promise<unknown>)(mockPrisma)
      : Promise.all(cb as Promise<unknown>[]),
  );
  mockPrisma.term.findMany.mockResolvedValue([FALL_TERM]);
  mockPrisma.payPeriod.upsert.mockResolvedValue({ id: "pp-1", name: PERIOD });
  mockPrisma.timesheetEntry.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.timesheetEntry.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.timesheetNote.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.timesheetNote.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.timesheetImport.create.mockResolvedValue({ id: "imp-1" });
});

describe("ingestTimesheet", () => {
  it("upserts the pay period with canonical name, UTC dates, and matched term", async () => {
    mockPrisma.timesheetEntry.createMany.mockResolvedValue({ count: 2 });

    const result = await ingestTimesheet([tsRow(), tsRow({ jobId: "4889" })], META);

    expect(mockPrisma.payPeriod.upsert).toHaveBeenCalledTimes(1);
    const args = mockPrisma.payPeriod.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ name: PERIOD });
    expect(args.create).toMatchObject({ name: PERIOD, termId: "term-25f" });
    expect(args.create.startDate.getTime()).toBe(Date.UTC(2025, 8, 14));
    expect(args.create.endDate.getTime()).toBe(Date.UTC(2025, 8, 27));
    // Update path must NOT clobber an admin-overridden termId.
    expect(args.update).not.toHaveProperty("termId");

    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]).toMatchObject({
      payPeriodId: "pp-1",
      payPeriodName: PERIOD,
      termId: "term-25f",
      rowsCreated: 2,
      rowsSkippedDuplicates: 0,
      rowsDeletedPrior: 0,
    });
    expect(result.invalidPeriods).toEqual([]);
  });

  it("replaces idempotently: deleteMany prior entries then createMany with skipDuplicates", async () => {
    mockPrisma.timesheetEntry.deleteMany.mockResolvedValue({ count: 5 });
    mockPrisma.timesheetEntry.createMany.mockResolvedValue({ count: 5 });

    const rows = [tsRow(), tsRow({ jobId: "4889" })];
    const result = await ingestTimesheet(rows, META);

    expect(mockPrisma.timesheetEntry.deleteMany).toHaveBeenCalledWith({
      where: { payPeriodId: "pp-1" },
    });
    const createArgs = mockPrisma.timesheetEntry.createMany.mock.calls[0][0];
    expect(createArgs.skipDuplicates).toBe(true);
    expect(createArgs.data).toHaveLength(2);
    expect(createArgs.data[0]).toMatchObject({
      payPeriodId: "pp-1",
      employeeNetId: "f00fake1",
      jobId: "4834",
      chartString: "18.722.161028.128512.4000",
      overtimeHours: null,
    });
    expect(result.periods[0].rowsDeletedPrior).toBe(5);
  });

  it("records the audit row with created / skipped-duplicate / deleted-prior counts", async () => {
    mockPrisma.timesheetEntry.deleteMany.mockResolvedValue({ count: 3 });
    // 2 rows submitted, 1 created → 1 skipped as in-file duplicate.
    mockPrisma.timesheetEntry.createMany.mockResolvedValue({ count: 1 });

    const result = await ingestTimesheet([tsRow(), tsRow()], META);

    expect(mockPrisma.timesheetImport.create).toHaveBeenCalledTimes(1);
    const auditArgs = mockPrisma.timesheetImport.create.mock.calls[0][0];
    expect(auditArgs.data).toMatchObject({
      fileName: "timesheet.csv",
      kind: "Timesheet",
      payPeriodId: "pp-1",
      rowsCreated: 1,
      rowsSkippedDuplicates: 1,
      rowsDeletedPrior: 3,
      uploadedById: "user-admin-1",
    });
    expect(result.periods[0].rowsSkippedDuplicates).toBe(1);
  });

  it("runs one transaction per pay period", async () => {
    mockPrisma.payPeriod.upsert
      .mockResolvedValueOnce({ id: "pp-1", name: PERIOD })
      .mockResolvedValueOnce({ id: "pp-2", name: "09/28/2025 - 10/11/2025" });
    mockPrisma.timesheetEntry.createMany.mockResolvedValue({ count: 1 });

    const result = await ingestTimesheet(
      [tsRow(), tsRow({ payPeriodName: "09/28/2025 - 10/11/2025" })],
      META,
    );

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    expect(result.periods).toHaveLength(2);
  });

  it("canonicalizes ' to ' period labels before upserting", async () => {
    mockPrisma.timesheetEntry.createMany.mockResolvedValue({ count: 1 });
    await ingestTimesheet([tsRow({ payPeriodName: "9/14/2025 to 9/27/2025" })], META);
    const args = mockPrisma.payPeriod.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ name: PERIOD });
  });

  it("skips invalid period labels without touching the database", async () => {
    const result = await ingestTimesheet(
      [tsRow({ payPeriodName: "not a period" })],
      META,
    );
    expect(result.periods).toEqual([]);
    expect(result.invalidPeriods).toEqual(["not a period"]);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("stores termId null when no term contains or precedes the period", async () => {
    mockPrisma.term.findMany.mockResolvedValue([
      { ...FALL_TERM, startDate: new Date(Date.UTC(2026, 0, 5)), endDate: new Date(Date.UTC(2026, 2, 10)) },
    ]);
    mockPrisma.timesheetEntry.createMany.mockResolvedValue({ count: 1 });

    const result = await ingestTimesheet([tsRow()], META);

    const args = mockPrisma.payPeriod.upsert.mock.calls[0][0];
    expect(args.create.termId).toBeNull();
    expect(result.periods[0].termId).toBeNull();
  });
});

describe("ingestNotes", () => {
  it("attaches notes to an existing period with sha-256 noteHash and skipDuplicates", async () => {
    mockPrisma.payPeriod.findUnique.mockResolvedValue({ id: "pp-1", name: PERIOD });
    mockPrisma.timesheetNote.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.timesheetNote.createMany.mockResolvedValue({ count: 1 });

    const note = "Compiler bug fixed";
    const result = await ingestNotes([noteRow({ note })], {
      fileName: "notes.csv",
      uploadedById: "user-admin-1",
    });

    const createArgs = mockPrisma.timesheetNote.createMany.mock.calls[0][0];
    expect(createArgs.skipDuplicates).toBe(true);
    expect(createArgs.data[0]).toMatchObject({
      payPeriodId: "pp-1",
      netId: "f00fake1",
      jobId: "4834",
      note,
      noteHash: createHash("sha256").update(note).digest("hex"),
    });

    const auditArgs = mockPrisma.timesheetImport.create.mock.calls[0][0];
    expect(auditArgs.data).toMatchObject({
      kind: "Notes",
      fileName: "notes.csv",
      payPeriodId: "pp-1",
      rowsCreated: 1,
      rowsSkippedDuplicates: 0,
      rowsDeletedPrior: 1,
    });

    expect(result.periods).toHaveLength(1);
    expect(result.skippedUnknownPeriods).toBe(0);
  });

  it("skips notes whose pay period has not been imported", async () => {
    mockPrisma.payPeriod.findUnique.mockResolvedValue(null);

    const result = await ingestNotes([noteRow(), noteRow({ jobId: "4889" })], {
      fileName: "notes.csv",
      uploadedById: "user-admin-1",
    });

    expect(result.periods).toEqual([]);
    expect(result.skippedUnknownPeriods).toBe(2);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("looks the period up by canonical name for ' to ' labels", async () => {
    mockPrisma.payPeriod.findUnique.mockResolvedValue({ id: "pp-1", name: PERIOD });
    mockPrisma.timesheetNote.createMany.mockResolvedValue({ count: 1 });

    await ingestNotes([noteRow({ payPeriodName: "09/14/2025 to 09/27/2025" })], {
      fileName: "notes.csv",
      uploadedById: "user-admin-1",
    });

    expect(mockPrisma.payPeriod.findUnique).toHaveBeenCalledWith({
      where: { name: PERIOD },
      select: { id: true, name: true },
    });
  });

  it("collects invalid period labels", async () => {
    const result = await ingestNotes([noteRow({ payPeriodName: "junk" })], {
      fileName: "notes.csv",
      uploadedById: "user-admin-1",
    });
    expect(result.invalidPeriods).toEqual(["junk"]);
    expect(result.periods).toEqual([]);
  });
});

describe("deletePayPeriod", () => {
  it("deletes the period by id (children cascade via FK)", async () => {
    mockPrisma.payPeriod.delete.mockResolvedValue({ id: "pp-1" });
    await deletePayPeriod("pp-1");
    expect(mockPrisma.payPeriod.delete).toHaveBeenCalledWith({
      where: { id: "pp-1" },
    });
  });
});
