import { prisma } from "~/lib/db";
import { rowsToCsv as rowsToCsvShared } from "~/lib/csv";

// ─── Constants per payroll spec ──────────────────────────────────────────────
// Single hardcoded primary/secondary supervisor for the whole lab. Per spec,
// every row gets these NetIDs. If supervisors ever differ per project, replace
// with a per-project field on Project (mirroring chartString).
export const PRIMARY_SUPERVISOR_NETID = "f0077bn";
export const SECONDARY_SUPERVISOR_NETID = "d1207c2";
export const ANTICIPATED_HOURS_PER_WEEK = "15";

// Lab-wide chart string for non-project payroll (Core + Instructor). Project
// rows pull their chart string from Project.chartString; these rows share one
// internal funding line. Type left blank — payroll didn't specify one for
// internal lines.
export const CORE_INSTRUCTOR_CHART_STRING_TYPE = "";
export const CORE_INSTRUCTOR_CHART_STRING = "18.722.161028.128512.3000";

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

export function formatDate(d: Date): string {
  // MMDDYY with no separators — the format JobX expects for hire dates. UTC to
  // match how Term start/end dates are stored (midnight UTC), avoiding an
  // off-by-one from local-timezone conversion.
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return mm + dd + yy;
}

// JobCodeLookup uses nullable `level` and `domainId` as wildcards. Match the
// most specific row first: exact (level, domain) > level-only > domain-only >
// wildcard. Returns null if nothing matches (admin should seed JobCodeLookup
// before relying on the export).
export function resolveJobCode(
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

// Member candidate for the Core / Instructor checkbox sections on the export
// page. One row per user per term (deduped across multiple Core titles or
// multiple instructor offerings). `subtitle` is just for the UI — the lead
// titles or offering names so admins can recognize who they're including.
export type RoleCandidate = {
  userId: string;
  netId: string | null;
  firstName: string;
  lastName: string;
  subtitle: string;
};

export async function listCoreCandidates(termId: string): Promise<RoleCandidate[]> {
  // CoreAssignment rows are materialized per-term across the election cycle
  // (writers in admin fan out across [Spring N, Spring N+1)), so a
  // direct lookup by termId surfaces the full cohort.
  const rows = await prisma.coreAssignment.findMany({
    where: { termId },
    select: {
      userId: true,
      leadTitle: true,
      user: { select: { netId: true, firstName: true, lastName: true } },
    },
  });

  const byUser = new Map<string, RoleCandidate & { titles: string[] }>();
  for (const r of rows) {
    const existing = byUser.get(r.userId);
    if (existing) {
      if (r.leadTitle) existing.titles.push(r.leadTitle);
    } else {
      byUser.set(r.userId, {
        userId: r.userId,
        netId: r.user.netId,
        firstName: r.user.firstName,
        lastName: r.user.lastName,
        subtitle: "",
        titles: r.leadTitle ? [r.leadTitle] : [],
      });
    }
  }

  return [...byUser.values()]
    .map(({ titles, ...c }) => ({ ...c, subtitle: titles.join(", ") }))
    .sort((a, b) =>
      (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName),
    );
}

export async function listInstructorCandidates(termId: string): Promise<RoleCandidate[]> {
  const rows = await prisma.instructorAssignment.findMany({
    where: { termId },
    select: {
      userId: true,
      user: { select: { netId: true, firstName: true, lastName: true } },
      offering: { select: { title: true } },
    },
  });

  const byUser = new Map<string, RoleCandidate & { offerings: string[] }>();
  for (const r of rows) {
    const existing = byUser.get(r.userId);
    if (existing) {
      existing.offerings.push(r.offering.title);
    } else {
      byUser.set(r.userId, {
        userId: r.userId,
        netId: r.user.netId,
        firstName: r.user.firstName,
        lastName: r.user.lastName,
        subtitle: "",
        offerings: [r.offering.title],
      });
    }
  }

  return [...byUser.values()]
    .map(({ offerings, ...c }) => ({ ...c, subtitle: offerings.join(", ") }))
    .sort((a, b) =>
      (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName),
    );
}

// Shared helper for Core/Instructor row generation. Same shape as project
// rows, but the chart string is the lab-wide internal line and the job code
// comes from the (assignmentType, NULL level, NULL domain) wildcard row.
async function buildNonProjectRows(
  termId: string,
  selectedUserIds: Set<string>,
  candidates: RoleCandidate[],
  assignmentType: "Core" | "Instructor",
): Promise<PayrollRow[]> {
  if (selectedUserIds.size === 0) return [];

  const [jobLookups, term] = await Promise.all([
    prisma.jobCodeLookup.findMany({
      where: { assignmentType },
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
  // Core/Instructor lookups don't carry level or domain — pass empty strings
  // and let the wildcard rows match.
  const job = resolveJobCode(jobLookups, "", "");

  return candidates
    .filter((c) => selectedUserIds.has(c.userId))
    .map((c) => {
      const warnings: string[] = [];
      if (!job) warnings.push(`No JobCodeLookup for ${assignmentType}`);
      if (!c.netId) warnings.push("User missing NetID");

      return {
        netId: c.netId ?? "",
        firstName: c.firstName,
        lastName: c.lastName,
        jobId: job?.jobCode ?? "",
        hourlyWage: job?.hourlyWage ?? "",
        hireStart,
        hireEnd,
        chartStringType: CORE_INSTRUCTOR_CHART_STRING_TYPE,
        chartString: CORE_INSTRUCTOR_CHART_STRING,
        warnings,
      };
    });
}

export async function buildCoreRows(
  termId: string,
  selectedUserIds: Set<string>,
): Promise<PayrollRow[]> {
  const candidates = await listCoreCandidates(termId);
  return buildNonProjectRows(termId, selectedUserIds, candidates, "Core");
}

export async function buildInstructorRows(
  termId: string,
  selectedUserIds: Set<string>,
): Promise<PayrollRow[]> {
  const candidates = await listInstructorCandidates(termId);
  return buildNonProjectRows(termId, selectedUserIds, candidates, "Instructor");
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
  const allRows: unknown[][] = [CSV_HEADERS.slice()];
  for (const r of rows) {
    allRows.push([
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
    ]);
  }
  return rowsToCsvShared(allRows);
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
