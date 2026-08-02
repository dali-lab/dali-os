import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn((_req: Request) =>
    Response.json({ error: "Forbidden" }, { status: 403 }),
  ),
}));
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn() }));
// The ingest server hits Prisma — stub it so the action test stays a pure
// orchestration/gating test over synthetic CSV strings.
vi.mock("~/admin/lib/payroll-ingest.server", () => ({
  ingestTimesheet: vi.fn(),
  ingestNotes: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import {
  ingestTimesheet,
  ingestNotes,
} from "~/admin/lib/payroll-ingest.server";
import { action } from "~/admin/routes/admin.payroll.upload";

const ADMIN_ID = "admin-1";

// A minimal valid TimesheetX header + one synthetic row (famous scientist,
// f00fake netid). Column set matches TIMESHEET_REQUIRED_HEADERS.
const VALID_TIMESHEET_CSV = [
  "Pay_Period_Name,Employee_Name,Employee_NetID,Job_Title,JobID,Shift_Start_Time,Shift_End_Time,Total_Shift_Time,Hourly_Pay_Rate,Total_Earnings,Pay_Code,Department,Chart_String,Timesheet_Status",
  "09/14/2025 - 09/27/2025,Lovelace Ada,f00fake1,DALI Lab Student Employee,4834,9/18/2025 4:00:00 PM,9/18/2025 6:00:00 PM,2,16.25,32.50,Regular Hours,DALI,18.722.161028.128512.4000,Finalized",
].join("\n");

// Missing the JobID / Total_Earnings etc. — not a TimesheetX export.
const BAD_HEADER_CSV = "Name,Hours\nAda,2\n";

function asAdmin() {
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: ADMIN_ID, email: "a@x.com", type: "user" },
  } as any);
  vi.mocked(isAdmin).mockResolvedValue(true);
}

function asNonAdmin() {
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "rando-1", email: "r@x.com", type: "user" },
  } as any);
  vi.mocked(isAdmin).mockResolvedValue(false);
}

function asAnon() {
  vi.mocked(requireAuth).mockResolvedValue({
    ok: false,
    response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    reason: "no_session",
  } as any);
}

function uploadRequest(files: { timesheet?: string; notes?: string }) {
  const fd = new FormData();
  if (files.timesheet !== undefined) {
    fd.append(
      "timesheet",
      new File([files.timesheet], "timesheet.csv", { type: "text/csv" }),
    );
  }
  if (files.notes !== undefined) {
    fd.append("notes", new File([files.notes], "notes.csv", { type: "text/csv" }));
  }
  return new Request("http://localhost/admin/payroll/upload", {
    method: "POST",
    body: fd,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ingestTimesheet).mockResolvedValue({
    periods: [
      {
        payPeriodId: "pp-1",
        payPeriodName: "09/14/2025 - 09/27/2025",
        termId: "term-25f",
        rowsCreated: 1,
        rowsSkippedDuplicates: 0,
        rowsDeletedPrior: 0,
      },
    ],
    invalidPeriods: [],
  } as any);
  vi.mocked(ingestNotes).mockResolvedValue({
    periods: [],
    invalidPeriods: [],
    skippedUnknownPeriods: 0,
  } as any);
});

describe("payroll upload action — auth gate", () => {
  it("returns the auth response for anonymous callers (no ingest)", async () => {
    asAnon();
    const res = await action({
      request: uploadRequest({ timesheet: VALID_TIMESHEET_CSV }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(401);
    expect(ingestTimesheet).not.toHaveBeenCalled();
  });

  it("returns 403 for non-admin callers (no ingest)", async () => {
    asNonAdmin();
    const res = await action({
      request: uploadRequest({ timesheet: VALID_TIMESHEET_CSV }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(403);
    expect(ingestTimesheet).not.toHaveBeenCalled();
  });
});

describe("payroll upload action — admin", () => {
  it("ingests a valid timesheet and returns import counts", async () => {
    asAdmin();
    const res = await action({
      request: uploadRequest({ timesheet: VALID_TIMESHEET_CSV }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.timesheet.periods).toHaveLength(1);
    expect(body.timesheet.periods[0].rowsCreated).toBe(1);
    expect(body.notes).toBeNull();
    expect(ingestTimesheet).toHaveBeenCalledOnce();
    // The parsed synthetic row reaches the ingest layer.
    const [rows] = vi.mocked(ingestTimesheet).mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].employeeNetId).toBe("f00fake1");
  });

  it("returns 400 with a clear message on a bad-header CSV (no ingest)", async () => {
    asAdmin();
    const res = await action({
      request: uploadRequest({ timesheet: BAD_HEADER_CSV }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Missing required timesheet column/i);
    expect(ingestTimesheet).not.toHaveBeenCalled();
  });

  it("returns 400 when no timesheet file is provided", async () => {
    asAdmin();
    const res = await action({
      request: uploadRequest({}),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/timesheet CSV is required/i);
    expect(ingestTimesheet).not.toHaveBeenCalled();
  });

  it("ingests notes after the timesheet when a notes file is present", async () => {
    asAdmin();
    const notesCsv = [
      "Pay_Period,Net_Id,Job_ID,Timesheet_Entry_Note1",
      "09/14/2025 - 09/27/2025,f00fake1,4834,Analytical engine maintenance",
    ].join("\n");
    const res = await action({
      request: uploadRequest({ timesheet: VALID_TIMESHEET_CSV, notes: notesCsv }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes).not.toBeNull();
    expect(ingestTimesheet).toHaveBeenCalledOnce();
    expect(ingestNotes).toHaveBeenCalledOnce();
  });
});
