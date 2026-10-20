import { describe, expect, it } from "vitest";
import {
  MAX_IMPORTED_JOBS,
  NotPositionsFileError,
  isDuplicate,
  jobIssue,
  parseLinkedInPositionsCsv,
  toImportedJob,
  toImportedJobs,
  toSavePayload,
  type ImportedJob,
} from "~/members/lib/work-history-import";
import { parseWorkExperience } from "~/members/lib/work-experience";

const HEADER = "Company Name,Title,Description,Location,Started On,Finished On";

describe("parseLinkedInPositionsCsv", () => {
  it("reads the real column set, including a BOM", async () => {
    const csv = `﻿${HEADER}\nFigma,Designer,Built things,"San Francisco, CA",Mar 2021,Jun 2023\n`;
    const [job] = await parseLinkedInPositionsCsv(csv);
    expect(job).toMatchObject({
      company: "Figma",
      position: "Designer",
      description: "Built things",
      location: "San Francisco, CA",
      startMonth: "2021-03",
      endMonth: "2023-06",
      current: false,
    });
  });

  it("matches reordered columns and different header case", async () => {
    const csv = "finished on,STARTED ON,title,company name,location,description\nMay 2020,Jan 2019,Intern,Acme,,\n";
    const [job] = await parseLinkedInPositionsCsv(csv);
    expect(job).toMatchObject({ company: "Acme", position: "Intern", startMonth: "2019-01", endMonth: "2020-05" });
  });

  it("keeps commas and newlines inside a quoted description", async () => {
    const csv = `${HEADER}\nAcme,Engineer,"Did a, b\nand c",,Jan 2020,\n`;
    const [job] = await parseLinkedInPositionsCsv(csv);
    expect(job.description).toBe("Did a, b\nand c");
  });

  it("takes a year-only date as a year with no month, and a blank Finished On as current", async () => {
    const csv = `${HEADER}\nAcme,Engineer,,,2018,\n`;
    const [job] = await parseLinkedInPositionsCsv(csv);
    expect(job).toMatchObject({ startMonth: "", startYear: 2018, endMonth: "", current: true });
  });

  it("throws NotPositionsFileError when a required header is missing", async () => {
    await expect(parseLinkedInPositionsCsv("Company Name,Title\nAcme,Engineer\n")).rejects.toBeInstanceOf(
      NotPositionsFileError,
    );
  });

  it("returns no jobs for an empty file with headers, and throws for a blank file", async () => {
    expect(await parseLinkedInPositionsCsv(`${HEADER}\n`)).toEqual([]);
    await expect(parseLinkedInPositionsCsv("")).rejects.toBeInstanceOf(NotPositionsFileError);
  });
});

describe("toImportedJob", () => {
  const base = {
    company: "Acme",
    position: "Engineer",
    start: { year: 2020, month: 4 },
    end: { year: 2021, month: 5 },
    current: false,
  };

  it("trims strings and turns empty ones into null", () => {
    const job = toImportedJob({ ...base, company: "  Acme  ", description: "   ", location: " NYC " });
    expect(job).toMatchObject({ company: "Acme", description: null, location: "NYC" });
  });

  it("drops a job with no company or no position", () => {
    expect(toImportedJob({ ...base, company: "  " })).toBeNull();
    expect(toImportedJob({ ...base, position: null })).toBeNull();
  });

  it("ignores the end date of a current job", () => {
    expect(toImportedJob({ ...base, current: true })).toMatchObject({ current: true, endMonth: "", endYear: null });
  });

  it("clamps years to 1950 through next year", () => {
    const nextYear = new Date().getUTCFullYear() + 1;
    expect(toImportedJob({ ...base, start: { year: 1949, month: 1 } })).toMatchObject({ startYear: null, startMonth: "" });
    expect(toImportedJob({ ...base, start: { year: 1950, month: 1 } })?.startMonth).toBe("1950-01");
    expect(toImportedJob({ ...base, end: { year: nextYear, month: 1 } })?.endMonth).toBe(`${nextYear}-01`);
    expect(toImportedJob({ ...base, end: { year: nextYear + 1, month: 1 } })).toMatchObject({ endMonth: "", endYear: null });
  });

  it("never invents a month", () => {
    expect(toImportedJob({ ...base, start: { year: 2020, month: null } })).toMatchObject({
      startMonth: "",
      startYear: 2020,
    });
    expect(toImportedJob({ ...base, start: { year: 2020, month: 13 } })?.startMonth).toBe("");
  });

  it("maps workMode only from the exact values", () => {
    expect(toImportedJob({ ...base, workMode: "Remote" })?.workMode).toBe("Remote");
    expect(toImportedJob({ ...base, workMode: "remote" })?.workMode).toBeNull();
    expect(toImportedJob({ ...base, workMode: "Onsite" })?.workMode).toBeNull();
  });

  it("caps the result at 40 jobs", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...base, company: `Co ${i}` }));
    const jobs = toImportedJobs(many);
    expect(jobs).toHaveLength(MAX_IMPORTED_JOBS);
    expect(new Set(jobs.map((j) => j.key)).size).toBe(MAX_IMPORTED_JOBS);
  });
});

describe("isDuplicate", () => {
  const existing = [{ company: "Figma, Inc.", startMonth: "2021-03" }];

  it("ignores case, punctuation and a trailing company suffix", () => {
    expect(isDuplicate({ company: "figma", startMonth: "2021-03" }, existing)).toBe(true);
    expect(isDuplicate({ company: "FIGMA INC", startMonth: "2021-03" }, existing)).toBe(true);
    expect(isDuplicate({ company: "Figma LLC", startMonth: "2021-03" }, existing)).toBe(true);
  });

  it("needs the same start month", () => {
    expect(isDuplicate({ company: "Figma", startMonth: "2021-04" }, existing)).toBe(false);
  });

  it("does not match a different company that merely contains the name", () => {
    expect(isDuplicate({ company: "Figma Labs", startMonth: "2021-03" }, existing)).toBe(false);
  });
});

describe("jobIssue", () => {
  const ok = { startMonth: "2020-01", endMonth: "2021-01", endYear: 2021, current: false };

  it("flags a missing start month", () => {
    expect(jobIssue({ ...ok, startMonth: "" })).toBe("Pick a start month");
  });

  it("flags a known end year with no month unless the job is current", () => {
    expect(jobIssue({ ...ok, endMonth: "" })).toBe("Pick an end month");
    expect(jobIssue({ ...ok, endMonth: "", current: true })).toBeNull();
  });

  it("passes a complete job", () => {
    expect(jobIssue(ok)).toBeNull();
  });
});

describe("toSavePayload", () => {
  const job: ImportedJob = {
    key: "job-0",
    company: "Acme",
    position: "Engineer",
    description: null,
    location: "NYC",
    workMode: "Hybrid",
    startMonth: "2020-04",
    startYear: 2020,
    endMonth: "2021-05",
    endYear: 2021,
    current: false,
  };

  it("round-trips through parseWorkExperience", () => {
    const payload = toSavePayload(job);
    const parsed = parseWorkExperience((f) => payload[f as keyof typeof payload] ?? "");
    expect(parsed).toEqual({
      ok: true,
      value: {
        company: "Acme",
        position: "Engineer",
        description: null,
        location: "NYC",
        workMode: "Hybrid",
        startDate: new Date(Date.UTC(2020, 3, 1)),
        endDate: new Date(Date.UTC(2021, 4, 1)),
      },
    });
  });

  it("sends no end month for a current job", () => {
    expect(toSavePayload({ ...job, current: true }).endMonth).toBe("");
  });
});
