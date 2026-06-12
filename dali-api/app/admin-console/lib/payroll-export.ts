import { prisma } from "~/lib/db";

// ─── Constants per payroll spec ──────────────────────────────────────────────
// Single hardcoded primary/secondary supervisor for the whole lab. Per spec,
// every row gets these NetIDs. If supervisors ever differ per project, replace
// with a per-project field on Project (mirroring chartString).
export const PRIMARY_SUPERVISOR_NETID = "f0077bn";
export const SECONDARY_SUPERVISOR_NETID = "d1207c2";
export const ANTICIPATED_HOURS_PER_WEEK = "15";

// 16-column header, order matters — Dartmouth payroll imports column-by-column.
export const CSV_HEADERS = [
  "Student NetID",
  "Student First Name",
  "Student Last Name",
  "Job ID",
  "Primary Supervisor NetID",
  "Secondary Supervisor NetID",
  "Hourly Wage",
  "Anticipated Hours per week",
  "Hire Start Date",
  "Hire End Date",
  "Chart String Type",
  "Full Chart String",
  "Student Phone Number",
  "Term",
  "Max Hours – PTO",
  "Max Hours – Mental Health",
] as const;

export type PayrollRow = {
  netId: string;
  firstName: string;
  lastName: string;
  jobId: string;
  hourlyWage: string;
  hireStart: string;
  hireEnd: string;
  chartStringType: string;
  chartString: string;
  // Tracked for the preview UI so admins can spot misconfigured projects /
  // missing job-code lookups before downloading. Omitted from CSV cells, where
  // a missing value is just an empty string.
  warnings: string[];
};

// RFC 4180 quoting: wrap in quotes if value contains a comma, quote, or newline;
// double up internal quotes.
function csvCell(raw: string): string {
  if (raw === "") return "";
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

export function formatDate(d: Date): string {
  // ISO YYYY-MM-DD; Dartmouth payroll accepts this format.
  return d.toISOString().slice(0, 10);
}

// JobCodeLookup uses nullable `level` and `domainId` as wildcards. Match the
// most specific row first: exact (level, domain) > level-only > domain-only >
// wildcard. Returns null if nothing matches (admin should seed JobCodeLookup
// before relying on the export).
function resolveJobCode(
  lookups: Array<{
    level: string | null;
    domainId: string | null;
    jobCode: string;
    payRateUsdHour: { toString(): string } | null;
  }>,
  level: string,
  domainId: string,
): { jobCode: string; hourlyWage: string } | null {
  const candidates = lookups
    .filter((l) => (l.level === null || l.level === level))
    .filter((l) => (l.domainId === null || l.domainId === domainId));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const specA = (a.level !== null ? 2 : 0) + (a.domainId !== null ? 1 : 0);
    const specB = (b.level !== null ? 2 : 0) + (b.domainId !== null ? 1 : 0);
    return specB - specA;
  });
  const best = candidates[0];
  return {
    jobCode: best.jobCode,
    hourlyWage: best.payRateUsdHour ? best.payRateUsdHour.toString() : "",
  };
}

export async function buildPayrollRows(termId: string): Promise<PayrollRow[]> {
  const [assignments, jobLookups, term] = await Promise.all([
    prisma.projectAssignment.findMany({
      where: { termId },
      include: {
        user: { select: { netId: true, firstName: true, lastName: true } },
        project: {
          select: { name: true, chartStringType: true, chartString: true },
        },
      },
      orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
    }),
    prisma.jobCodeLookup.findMany({
      where: { assignmentType: "Project" },
      select: { level: true, domainId: true, jobCode: true, payRateUsdHour: true },
    }),
    prisma.term.findUnique({
      where: { id: termId },
      select: { startDate: true, endDate: true },
    }),
  ]);

  if (!term) return [];

  const hireStart = formatDate(term.startDate);
  const hireEnd = formatDate(term.endDate);

  return assignments.map((a) => {
    const warnings: string[] = [];
    const job = resolveJobCode(jobLookups, a.level, a.domainId);
    if (!job) warnings.push(`No JobCodeLookup for level=${a.level}`);
    if (!a.project.chartString) warnings.push("Project missing chartString");
    if (!a.user.netId) warnings.push("User missing NetID");

    return {
      netId: a.user.netId ?? "",
      firstName: a.user.firstName,
      lastName: a.user.lastName,
      jobId: job?.jobCode ?? "",
      hourlyWage: job?.hourlyWage ?? "",
      hireStart,
      hireEnd,
      chartStringType: a.project.chartStringType ?? "",
      chartString: a.project.chartString ?? "",
      warnings,
    };
  });
}

export function rowsToCsv(rows: PayrollRow[]): string {
  const lines: string[] = [];
  lines.push(CSV_HEADERS.map(csvCell).join(","));
  for (const r of rows) {
    lines.push(
      [
        r.netId,
        r.firstName,
        r.lastName,
        r.jobId,
        PRIMARY_SUPERVISOR_NETID,
        SECONDARY_SUPERVISOR_NETID,
        r.hourlyWage,
        ANTICIPATED_HOURS_PER_WEEK,
        r.hireStart,
        r.hireEnd,
        r.chartStringType,
        r.chartString,
        "", // Student Phone Number — blank per spec
        "", // Term — blank per spec
        "", // Max Hours – PTO — blank per spec
        "", // Max Hours – Mental Health — blank per spec
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // RFC 4180 uses CRLF; payroll importers handle either, CRLF is safer for
  // Excel on Windows.
  return lines.join("\r\n") + "\r\n";
}

// Picks the term that contains today, falling back to the most recent term.
// Shared so the page and the CSV route default to the same selection when no
// explicit termId is on the URL.
export function pickDefaultTermId(
  terms: { id: string; startDate: Date; endDate: Date }[],
  now: Date = new Date(),
): string | null {
  if (terms.length === 0) return null;
  const current = terms.find((t) => t.startDate <= now && now <= t.endDate);
  return (current ?? terms[0]).id;
}
