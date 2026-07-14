import { describe, it, expect } from "vitest";
import {
  parseTimesheetCsv,
  parseNotesCsv,
  CsvHeaderError,
} from "~/admin-console/lib/payroll-csv";

// All fixture data is fully synthetic: famous computer scientists with
// f00fake* netids. Never real students.

const TS_HEADER =
  "Chart_String1,Pay_Period_Name,Employee_Name,Employee_NetID,Job_Title,JobID," +
  "Shift_Start_Time,Shift_End_Time,Total_Shift_Time,Hourly_Pay_Rate,Total_Earnings," +
  "Pay_Code,Department,Supervisor_First_Name,Supervisor_Last_Name,TS_Approver," +
  "Chart_String,Timesheet_Status,Overtime_Hours,Overtime_Earnings,Textbox7,Textbox233";

type TsRow = {
  payPeriod?: string;
  name?: string;
  netId?: string;
  jobTitle?: string;
  jobId?: string;
  shiftStart?: string;
  shiftEnd?: string;
  hours?: string;
  rate?: string;
  earnings?: string;
  payCode?: string;
  department?: string;
  chartString?: string;
  status?: string;
  overtimeHours?: string;
  overtimeEarnings?: string;
};

function tsRow(o: TsRow = {}): string {
  return [
    o.chartString ?? "18.722.161028.128512.4000", // Chart_String1
    o.payPeriod ?? "09/14/2025 - 09/27/2025",
    o.name ?? '"Lovelace, Ada"',
    o.netId ?? "f00fake1",
    o.jobTitle ?? "DALI Lab Student Employee",
    o.jobId ?? "4834",
    o.shiftStart ?? "9/18/2025 4:00:00 PM",
    o.shiftEnd ?? "9/18/2025 6:00:00 PM",
    o.hours ?? "2.000000",
    o.rate ?? "16.25",
    o.earnings ?? "32.50000000",
    o.payCode ?? "Regular Hours",
    o.department ?? "Magnuson Center",
    "Grace",
    "Hopper",
    "Grace  Hopper",
    o.chartString ?? "18.722.161028.128512.4000", // Chart_String
    o.status ?? "Finalized",
    o.overtimeHours ?? "",
    o.overtimeEarnings ?? "",
    "786519",
    "185.716662",
  ].join(",");
}

function tsCsv(rows: string[], header = TS_HEADER): string {
  return [header, ...rows].join("\r\n") + "\r\n";
}

const NOTES_HEADER =
  "Pay_Period,Employee_First_Name1,Employee_Last_Name1,Net_Id,Job_Title,Job_ID," +
  "Department,Supervisor_Name,Supervisor_Email,Timesheet_Approver," +
  "Timesheet_Entry_Note1,Validated_Chartstring1,Link_to_Timesheet1";

function noteRow(o: {
  payPeriod?: string;
  netId?: string;
  jobId?: string;
  note?: string;
  chartstring?: string;
  link?: string;
} = {}): string {
  return [
    o.payPeriod ?? "09/14/2025 - 09/27/2025",
    "Ada",
    "Lovelace",
    o.netId ?? "f00fake1",
    "DALI Lab Student Employee",
    o.jobId ?? "4834",
    "Magnuson Center",
    "Grace Hopper",
    "grace.hopper@example.edu",
    "Grace Hopper",
    o.note ?? "Analytical engine maintenance",
    o.chartstring ?? "18.722.161028.128512.4000",
    o.link ?? '"<a href=""Tsx.aspx?tsid=1"" target=""new"">09/14/2025 - 09/27/2025</a>"',
  ].join(",");
}

function notesCsv(rows: string[], header = NOTES_HEADER): string {
  return [header, ...rows].join("\r\n") + "\r\n";
}

describe("parseTimesheetCsv", () => {
  it("parses a valid row into typed fields", () => {
    const { rows, errors } = parseTimesheetCsv(tsCsv([tsRow()]));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      payPeriodName: "09/14/2025 - 09/27/2025",
      employeeNetId: "f00fake1",
      employeeName: "Lovelace, Ada",
      jobId: "4834",
      jobTitle: "DALI Lab Student Employee",
      chartString: "18.722.161028.128512.4000",
      totalShiftTime: 2,
      hourlyPayRate: 16.25,
      totalEarnings: 32.5,
      overtimeHours: null,
      overtimeEarnings: null,
      payCode: "Regular Hours",
      supervisorName: "Grace Hopper",
      timesheetStatus: "Finalized",
    });
  });

  it("handles a UTF-8 BOM before the header row", () => {
    const { rows, errors } = parseTimesheetCsv("\uFEFF" + tsCsv([tsRow()]));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].payPeriodName).toBe("09/14/2025 - 09/27/2025");
  });

  it("ignores trailing Textbox* columns (reads only named columns)", () => {
    const { rows } = parseTimesheetCsv(tsCsv([tsRow()]));
    expect(Object.keys(rows[0])).not.toContain("Textbox7");
  });

  it("fails fast with CsvHeaderError when required headers are missing", () => {
    const badHeader = TS_HEADER.replace("Total_Shift_Time,", "");
    // Rebuild rows with one fewer column so papaparse doesn't misalign.
    expect(() => parseTimesheetCsv(badHeader + "\r\n")).toThrowError(CsvHeaderError);
    try {
      parseTimesheetCsv(badHeader + "\r\n");
    } catch (e) {
      expect((e as CsvHeaderError).missing).toContain("Total_Shift_Time");
      expect((e as Error).message).toMatch(/Total_Shift_Time/);
    }
  });

  it("accepts the Pay_Period / Net_Id header aliases", () => {
    const aliasHeader = TS_HEADER.replace("Pay_Period_Name", "Pay_Period").replace(
      "Employee_NetID",
      "Net_Id",
    );
    const { rows, errors } = parseTimesheetCsv(tsCsv([tsRow()], aliasHeader));
    expect(errors).toEqual([]);
    expect(rows[0].payPeriodName).toBe("09/14/2025 - 09/27/2025");
    expect(rows[0].employeeNetId).toBe("f00fake1");
  });

  it("lowercases netIds", () => {
    const { rows } = parseTimesheetCsv(tsCsv([tsRow({ netId: "F00FAKE1" })]));
    expect(rows[0].employeeNetId).toBe("f00fake1");
  });

  it('stores "" for blank dedupe-key fields (chartString, payCode, shift times)', () => {
    const { rows, errors } = parseTimesheetCsv(
      tsCsv([tsRow({ chartString: "", payCode: "", shiftStart: "", shiftEnd: "" })]),
    );
    expect(errors).toEqual([]);
    expect(rows[0].chartString).toBe("");
    expect(rows[0].payCode).toBe("");
    expect(rows[0].shiftStartTime).toBe("");
    expect(rows[0].shiftEndTime).toBe("");
  });

  it("strips $ and thousands separators from money fields", () => {
    const { rows, errors } = parseTimesheetCsv(
      tsCsv([tsRow({ earnings: '"$1,234.50"' })]),
    );
    expect(errors).toEqual([]);
    expect(rows[0].totalEarnings).toBe(1234.5);
  });

  it("collects a per-row error for unparseable numerics and excludes the row", () => {
    const { rows, errors } = parseTimesheetCsv(
      tsCsv([tsRow(), tsRow({ hours: "abc", netId: "f00fake2" }), tsRow()]),
    );
    expect(rows).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ row: 3, field: "totalShiftTime" });
    expect(errors[0].message).toMatch(/Total_Shift_Time/);
  });

  it("treats blank required numerics as errors, not silent zeros", () => {
    const { rows, errors } = parseTimesheetCsv(tsCsv([tsRow({ earnings: "" })]));
    expect(rows).toHaveLength(0);
    expect(errors.some((e) => e.field === "totalEarnings")).toBe(true);
  });

  it("errors on unparseable optional overtime but accepts blank as null", () => {
    const { rows, errors } = parseTimesheetCsv(
      tsCsv([
        tsRow({ overtimeHours: "1.5", overtimeEarnings: "24.38" }),
        tsRow({ overtimeHours: "oops", netId: "f00fake2" }),
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].overtimeHours).toBe(1.5);
    expect(rows[0].overtimeEarnings).toBe(24.38);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("overtimeHours");
  });

  it("errors on rows missing the netId or pay period", () => {
    const { rows, errors } = parseTimesheetCsv(
      tsCsv([tsRow({ netId: "" }), tsRow({ payPeriod: "" })]),
    );
    expect(rows).toHaveLength(0);
    expect(errors.map((e) => e.field).sort()).toEqual([
      "employeeNetId",
      "payPeriodName",
    ]);
  });

  it("keeps jobId as a string", () => {
    const { rows } = parseTimesheetCsv(tsCsv([tsRow({ jobId: "07523" })]));
    expect(rows[0].jobId).toBe("07523");
  });
});

describe("parseNotesCsv", () => {
  it("parses a valid note row", () => {
    const { rows, errors } = parseNotesCsv(notesCsv([noteRow()]));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      payPeriodName: "09/14/2025 - 09/27/2025",
      netId: "f00fake1",
      jobId: "4834",
      note: "Analytical engine maintenance",
      validatedChartstring: "18.722.161028.128512.4000",
    });
    expect(rows[0].linkToTimesheet).toMatch(/Tsx\.aspx/);
  });

  it("handles a UTF-8 BOM", () => {
    const { rows, errors } = parseNotesCsv("\uFEFF" + notesCsv([noteRow()]));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it("fails fast when the note column is missing", () => {
    const badHeader = NOTES_HEADER.replace("Timesheet_Entry_Note1,", "");
    expect(() => parseNotesCsv(badHeader + "\r\n")).toThrowError(CsvHeaderError);
  });

  it("lowercases netIds and errors on blank notes", () => {
    const { rows, errors } = parseNotesCsv(
      notesCsv([noteRow({ netId: "F00FAKE2", note: "Compiling" }), noteRow({ note: "" })]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].netId).toBe("f00fake2");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ row: 3, field: "note" });
  });

  it("null for blank optional chartstring/link", () => {
    const { rows } = parseNotesCsv(
      notesCsv([noteRow({ chartstring: "", link: "" })]),
    );
    expect(rows[0].validatedChartstring).toBeNull();
    expect(rows[0].linkToTimesheet).toBeNull();
  });
});
