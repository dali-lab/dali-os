// Pure collation core for payroll reconciliation (no Prisma → fully
// unit-testable). Ported from dali-hr's dataCollator with the dali-os design
// substitutions (see plan §"Collation / reporting"):
//
//   - Hours  = Σ totalShiftTime.
//   - Pay    = Σ totalEarnings *directly* (never wage × hours).
//   - jobId is classified via a JobCodeLookup reverse-lookup: DALI
//     (Project/Core/Instructor + level) vs an External bucket (never a
//     discrepancy). External money is reported separately so DALI + External
//     reconciles to the CSV total.
//   - Project attribution is an assignment fan-out with `sharedWith`; the
//     charged chart string is only a suffix-normalized tie-break.
//
// The discrepancy taxonomy is a deliberate redesign of dali-hr's — do not read
// dali-hr equivalence into it.

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** One timesheet shift. Money/hours are plain numbers (converted at the edge). */
export type CollationEntry = {
  employeeNetId: string; // already lowercased at ingest
  employeeName: string;
  jobId: string;
  jobTitle: string;
  chartString: string;
  totalShiftTime: number;
  hourlyPayRate: number;
  totalEarnings: number;
};

/** A JobCodeLookup row (reverse-lookup source). `payRateUsdHour` may be null. */
export type CollationLookup = {
  jobCode: string;
  assignmentType: "Project" | "Core" | "Instructor" | "DomainLead" | "Admin";
  level: string | null;
  payRateUsdHour: number | null;
};

/** A User row for the netId → person join. */
export type CollationUser = {
  netId: string; // lowercased
  firstName: string;
  lastName: string;
};

/** A ProjectAssignment fan-out row (which projects a person works, per term). */
export type CollationAssignment = {
  netId: string; // lowercased
  projectId: string;
  projectName: string;
  projectChartString: string | null;
};

/** An authoritative Project (for chart-string → project inference). */
export type CollationProject = {
  id: string;
  name: string;
  chartString: string | null;
};

export type CollationInput = {
  entries: CollationEntry[];
  lookups: CollationLookup[];
  users: CollationUser[];
  assignments: CollationAssignment[];
  projects: CollationProject[];
  /** Rate-mismatch discrepancies are only meaningful for the active term. */
  isActiveTerm: boolean;
};

// ─── Outputs ─────────────────────────────────────────────────────────────────

export type JobCategory = "Project" | "Core" | "Instructor" | "External";

export type JobBreakdown = {
  netId: string;
  name: string;
  jobId: string;
  jobTitle: string;
  category: JobCategory;
  hours: number;
  /** Σ totalEarnings for this (person, job). */
  pay: number;
  /** Other project names this (person, job)'s hours are also attributed to. */
  sharedWith: string[];
};

export type ProjectSummary = {
  projectId: string;
  projectName: string;
  totalHours: number;
  /** Portion of totalHours contributed by shared (multi-project) jobs. */
  sharedHours: number;
  totalPay: number;
  jobs: JobBreakdown[];
};

/** Core / Instructor / External rollups (no project attribution). */
export type NonProjectSummary = {
  category: "Core" | "Instructor" | "External";
  totalHours: number;
  totalPay: number;
  jobs: JobBreakdown[];
};

export type ChartStringStudent = {
  netId: string;
  name: string;
  hours: number;
  pay: number;
};

export type ChartStringSummary = {
  chartString: string;
  totalHours: number;
  totalPay: number;
  /** Project(s) matching this chart string; >1 → ambiguousProject. */
  projects: { id: string; name: string }[];
  ambiguousProject: boolean;
  students: ChartStringStudent[];
};

export type AssignedNoHoursDiscrepancy = {
  type: "assigned_no_hours";
  netId: string;
  name: string;
  projectId: string;
  projectName: string;
};

export type UnassignedJobDiscrepancy = {
  type: "unassigned_job";
  netId: string;
  name: string;
  jobId: string;
  jobTitle: string;
  hours: number;
  pay: number;
  /** Best-guess project (chartString→Project, else another holder). */
  inferredProjectId: string | null;
  inferredProjectName: string | null;
};

export type RateMismatchDiscrepancy = {
  type: "rate_mismatch";
  netId: string;
  name: string;
  jobId: string;
  jobTitle: string;
  hours: number;
  /** Σ totalEarnings for the job. */
  actualPay: number;
  /** lookupRate × hours. */
  expectedPay: number;
  /** actualPay − expectedPay. */
  difference: number;
  lookupRate: number;
};

export type UnknownPersonDiscrepancy = {
  type: "unknown_person";
  netId: string;
  name: string;
  hours: number;
  pay: number;
};

export type Discrepancies = {
  assignedNoHours: AssignedNoHoursDiscrepancy[];
  unassignedJobs: UnassignedJobDiscrepancy[];
  rateMismatches: RateMismatchDiscrepancy[];
  unknownPersons: UnknownPersonDiscrepancy[];
};

export type CollationSummary = {
  /** Every shift once — DALI only (Project + Core + Instructor). */
  daliHours: number;
  daliPay: number;
  /** Every shift once — non-DALI jobIds, reported but excluded from DALI. */
  externalHours: number;
  externalPay: number;
  /** daliHours + externalHours (reconciles to the raw CSV totals). */
  totalHours: number;
  totalPay: number;
  daliStudentCount: number;
  medianPay: number;
};

export type CollatedResult = {
  projects: ProjectSummary[];
  core: NonProjectSummary;
  instructor: NonProjectSummary;
  external: NonProjectSummary;
  chartStrings: ChartStringSummary[];
  discrepancies: Discrepancies;
  summary: CollationSummary;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const jobKey = (netId: string, jobId: string) => `${netId}::${jobId}`;

/**
 * Suffix-normalize a chart string for tie-break comparison: drop the first
 * dot-delimited segment (the drifting "18." vs "20." rate-family prefix seen
 * within a single export). "18.722.161028.128512.4000" →
 * "722.161028.128512.4000".
 */
function normalizeChartSuffix(cs: string): string {
  const trimmed = cs.trim();
  const dot = trimmed.indexOf(".");
  return dot === -1 ? trimmed : trimmed.slice(dot + 1);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

type Classification =
  | { category: "Project" | "Core" | "Instructor"; lookupRate: number | null }
  | { category: "External" };

/**
 * Classify a jobId by reverse-lookup on JobCodeLookup.jobCode. Collects ALL
 * matching rows (a jobId can map to several levels, e.g. 4834→P1+P2). Category
 * = the assignmentType of the matches (Project vs Core vs Instructor).
 * lookupRate = the single non-null rate if all matching rows agree, else null
 * (ambiguous/absent rate → skip rate math). Unmatched jobId → External.
 */
function classifyJob(
  jobId: string,
  byJobCode: Map<string, CollationLookup[]>,
): Classification {
  const matches = byJobCode.get(jobId);
  if (!matches || matches.length === 0) return { category: "External" };

  // Category: Project/Core/Instructor. DomainLead/Admin lookups (if any) are
  // treated as non-DALI-payroll and fall through to External.
  const match = matches.find(
    (m): m is CollationLookup & { assignmentType: "Project" | "Core" | "Instructor" } =>
      m.assignmentType === "Project" ||
      m.assignmentType === "Core" ||
      m.assignmentType === "Instructor",
  );
  if (!match) return { category: "External" };
  const cat = match.assignmentType;

  const rates = new Set(
    matches
      .filter((m) => m.assignmentType === cat && m.payRateUsdHour !== null)
      .map((m) => m.payRateUsdHour as number),
  );
  const lookupRate = rates.size === 1 ? [...rates][0] : null;

  return { category: cat, lookupRate };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function collate(input: CollationInput): CollatedResult {
  const { entries, lookups, users, assignments, projects, isActiveTerm } = input;

  // Indexes.
  const byJobCode = new Map<string, CollationLookup[]>();
  for (const l of lookups) {
    const arr = byJobCode.get(l.jobCode) ?? [];
    arr.push(l);
    byJobCode.set(l.jobCode, arr);
  }

  const userByNetId = new Map<string, CollationUser>();
  for (const u of users) userByNetId.set(u.netId, u);

  // netId → assignment rows (project fan-out).
  const assignmentsByNetId = new Map<string, CollationAssignment[]>();
  for (const a of assignments) {
    const arr = assignmentsByNetId.get(a.netId) ?? [];
    arr.push(a);
    assignmentsByNetId.set(a.netId, arr);
  }

  const projectById = new Map<string, CollationProject>();
  for (const p of projects) projectById.set(p.id, p);

  // Chart-suffix → project ids (for chartString→Project inference/tie-break).
  const projectsByChartSuffix = new Map<string, Set<string>>();
  for (const p of projects) {
    if (!p.chartString) continue;
    const suffix = normalizeChartSuffix(p.chartString);
    const set = projectsByChartSuffix.get(suffix) ?? new Set();
    set.add(p.id);
    projectsByChartSuffix.set(suffix, set);
  }

  // jobId → project ids worked by *assigned* holders of that jobId. Used to
  // infer a likely project for an unassigned holder "via another holder": a
  // netId who ran shifts on this jobId AND has a ProjectAssignment lends their
  // project(s) as the best guess.
  const assignedProjectsByJobId = new Map<string, Set<string>>();
  {
    const netIdsByJobId = new Map<string, Set<string>>();
    for (const e of entries) {
      const set = netIdsByJobId.get(e.jobId) ?? new Set<string>();
      set.add(e.employeeNetId);
      netIdsByJobId.set(e.jobId, set);
    }
    for (const [jid, netIds] of netIdsByJobId) {
      const projIds = new Set<string>();
      for (const netId of netIds) {
        for (const a of assignmentsByNetId.get(netId) ?? []) {
          projIds.add(a.projectId);
        }
      }
      if (projIds.size > 0) assignedProjectsByJobId.set(jid, projIds);
    }
  }

  // ─── Aggregate raw entry sums per (netId, jobId) ──────────────────────────
  type JobAgg = {
    netId: string;
    name: string;
    jobId: string;
    jobTitle: string;
    hours: number;
    pay: number;
    /** distinct chart strings charged for this job (for tie-break). */
    chartStrings: Set<string>;
  };
  const jobAggs = new Map<string, JobAgg>();
  for (const e of entries) {
    const k = jobKey(e.employeeNetId, e.jobId);
    let agg = jobAggs.get(k);
    if (!agg) {
      agg = {
        netId: e.employeeNetId,
        name: e.employeeName,
        jobId: e.jobId,
        jobTitle: e.jobTitle,
        hours: 0,
        pay: 0,
        chartStrings: new Set(),
      };
      jobAggs.set(k, agg);
    }
    agg.hours += e.totalShiftTime;
    agg.pay += e.totalEarnings;
    if (e.chartString) agg.chartStrings.add(e.chartString);
  }

  // ─── Project attribution + non-project rollups ────────────────────────────
  const projectAcc = new Map<
    string,
    { name: string; hours: number; sharedHours: number; pay: number; jobs: JobBreakdown[] }
  >();
  const coreJobs: JobBreakdown[] = [];
  const instructorJobs: JobBreakdown[] = [];
  const externalJobs: JobBreakdown[] = [];

  const daliStudents = new Set<string>();
  const unassignedJobs: UnassignedJobDiscrepancy[] = [];
  const unknownPersons: UnknownPersonDiscrepancy[] = [];

  let daliHours = 0;
  let daliPay = 0;
  let externalHours = 0;
  let externalPay = 0;

  const ensureProject = (id: string, name: string) => {
    let acc = projectAcc.get(id);
    if (!acc) {
      acc = { name, hours: 0, sharedHours: 0, pay: 0, jobs: [] };
      projectAcc.set(id, acc);
    }
    return acc;
  };

  for (const agg of jobAggs.values()) {
    const cls = classifyJob(agg.jobId, byJobCode);
    const user = userByNetId.get(agg.netId);
    const name = user ? `${user.firstName} ${user.lastName}`.trim() : agg.name;

    if (cls.category === "External") {
      externalHours += agg.hours;
      externalPay += agg.pay;
      externalJobs.push({
        netId: agg.netId,
        name,
        jobId: agg.jobId,
        jobTitle: agg.jobTitle,
        category: "External",
        hours: agg.hours,
        pay: agg.pay,
        sharedWith: [],
      });
      continue;
    }

    // DALI (Project/Core/Instructor).
    daliHours += agg.hours;
    daliPay += agg.pay;
    daliStudents.add(agg.netId);

    // Unknown-person: still counted in DALI money totals, flagged separately.
    if (!user) {
      unknownPersons.push({
        type: "unknown_person",
        netId: agg.netId,
        name: agg.name,
        hours: agg.hours,
        pay: agg.pay,
      });
    }

    if (cls.category === "Core" || cls.category === "Instructor") {
      const bucket = cls.category === "Core" ? coreJobs : instructorJobs;
      bucket.push({
        netId: agg.netId,
        name,
        jobId: agg.jobId,
        jobTitle: agg.jobTitle,
        category: cls.category,
        hours: agg.hours,
        pay: agg.pay,
        sharedWith: [],
      });
      continue;
    }

    // cls.category === "Project": attribute via assignment fan-out.
    const personAssignments = assignmentsByNetId.get(agg.netId) ?? [];

    let targetProjects = personAssignments;
    // Chart-string suffix tie-break: if the charged suffix matches exactly one
    // assigned project, narrow to it. Never let it override the assignment
    // join (only narrows within already-assigned projects).
    if (personAssignments.length > 1 && agg.chartStrings.size > 0) {
      const chargedSuffixes = new Set(
        [...agg.chartStrings].map(normalizeChartSuffix),
      );
      const narrowed = personAssignments.filter(
        (a) =>
          a.projectChartString &&
          chargedSuffixes.has(normalizeChartSuffix(a.projectChartString)),
      );
      if (narrowed.length === 1) targetProjects = narrowed;
    }

    if (targetProjects.length === 0) {
      // DALI Project job with no matching assignment → unassigned-job
      // discrepancy. Infer likely project: chartString→Project, else another
      // holder of this jobId.
      const { id: inferredId, name: inferredName } = inferProject(
        agg,
        projectsByChartSuffix,
        projectById,
        assignedProjectsByJobId,
      );
      unassignedJobs.push({
        type: "unassigned_job",
        netId: agg.netId,
        name,
        jobId: agg.jobId,
        jobTitle: agg.jobTitle,
        hours: agg.hours,
        pay: agg.pay,
        inferredProjectId: inferredId,
        inferredProjectName: inferredName,
      });
      continue;
    }

    const shared = targetProjects.length > 1;
    const projectNames = targetProjects.map((a) => a.projectName);
    for (const a of targetProjects) {
      const acc = ensureProject(a.projectId, a.projectName);
      acc.hours += agg.hours;
      acc.pay += agg.pay;
      if (shared) acc.sharedHours += agg.hours;
      acc.jobs.push({
        netId: agg.netId,
        name,
        jobId: agg.jobId,
        jobTitle: agg.jobTitle,
        category: "Project",
        hours: agg.hours,
        pay: agg.pay,
        sharedWith: shared
          ? projectNames.filter((n) => n !== a.projectName)
          : [],
      });
    }
  }

  // ─── Discrepancy: assigned-but-0-hours (Project assignments with no shift) ──
  // A (netId, projectId) is "worked" if any Project-category job for that netId
  // landed in that project. Assigned pairs with no worked hours are flagged.
  const workedPairs = new Set<string>();
  for (const [pid, acc] of projectAcc) {
    for (const j of acc.jobs) workedPairs.add(`${j.netId}::${pid}`);
  }
  const assignedNoHours: AssignedNoHoursDiscrepancy[] = [];
  const seenAssignedPair = new Set<string>();
  for (const a of assignments) {
    const pairKey = `${a.netId}::${a.projectId}`;
    if (seenAssignedPair.has(pairKey)) continue;
    seenAssignedPair.add(pairKey);
    if (workedPairs.has(pairKey)) continue;
    const user = userByNetId.get(a.netId);
    assignedNoHours.push({
      type: "assigned_no_hours",
      netId: a.netId,
      name: user ? `${user.firstName} ${user.lastName}`.trim() : a.netId,
      projectId: a.projectId,
      projectName: a.projectName,
    });
  }

  // ─── Discrepancy: rate mismatch (DALI only, active term only) ──────────────
  const rateMismatches: RateMismatchDiscrepancy[] = [];
  if (isActiveTerm) {
    for (const agg of jobAggs.values()) {
      const cls = classifyJob(agg.jobId, byJobCode);
      if (cls.category === "External" || cls.lookupRate === null) continue;
      const expectedPay = cls.lookupRate * agg.hours;
      const difference = agg.pay - expectedPay;
      if (Math.abs(difference) > 0.01) {
        const user = userByNetId.get(agg.netId);
        rateMismatches.push({
          type: "rate_mismatch",
          netId: agg.netId,
          name: user ? `${user.firstName} ${user.lastName}`.trim() : agg.name,
          jobId: agg.jobId,
          jobTitle: agg.jobTitle,
          hours: agg.hours,
          actualPay: agg.pay,
          expectedPay,
          difference,
          lookupRate: cls.lookupRate,
        });
      }
    }
    rateMismatches.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
  }

  // ─── Chart-string aggregation (over the charged chart string) ──────────────
  const chartAcc = new Map<
    string,
    {
      hours: number;
      pay: number;
      students: Map<string, ChartStringStudent>;
    }
  >();
  for (const e of entries) {
    const cs = (e.chartString || "Unknown").trim();
    let acc = chartAcc.get(cs);
    if (!acc) {
      acc = { hours: 0, pay: 0, students: new Map() };
      chartAcc.set(cs, acc);
    }
    acc.hours += e.totalShiftTime;
    acc.pay += e.totalEarnings;
    let s = acc.students.get(e.employeeNetId);
    if (!s) {
      const user = userByNetId.get(e.employeeNetId);
      s = {
        netId: e.employeeNetId,
        name: user ? `${user.firstName} ${user.lastName}`.trim() : e.employeeName,
        hours: 0,
        pay: 0,
      };
      acc.students.set(e.employeeNetId, s);
    }
    s.hours += e.totalShiftTime;
    s.pay += e.totalEarnings;
  }

  const chartStrings: ChartStringSummary[] = [...chartAcc.entries()]
    .map(([chartString, data]) => {
      const suffix = normalizeChartSuffix(chartString);
      const projIds = [...(projectsByChartSuffix.get(suffix) ?? new Set<string>())];
      const projs = projIds
        .map((id) => projectById.get(id))
        .filter((p): p is CollationProject => p !== undefined)
        .map((p) => ({ id: p.id, name: p.name }));
      return {
        chartString,
        totalHours: data.hours,
        totalPay: data.pay,
        projects: projs,
        ambiguousProject: projs.length > 1,
        students: [...data.students.values()].sort((a, b) => b.pay - a.pay),
      };
    })
    .sort((a, b) => a.chartString.localeCompare(b.chartString));

  // ─── Assemble ──────────────────────────────────────────────────────────────
  const projectSummaries: ProjectSummary[] = [...projectAcc.entries()]
    .map(([projectId, acc]) => ({
      projectId,
      projectName: acc.name,
      totalHours: acc.hours,
      sharedHours: acc.sharedHours,
      totalPay: acc.pay,
      jobs: acc.jobs.sort((a, b) => b.pay - a.pay),
    }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName));

  const rollup = (
    category: "Core" | "Instructor" | "External",
    jobs: JobBreakdown[],
  ): NonProjectSummary => ({
    category,
    totalHours: jobs.reduce((s, j) => s + j.hours, 0),
    totalPay: jobs.reduce((s, j) => s + j.pay, 0),
    jobs: jobs.sort((a, b) => b.pay - a.pay),
  });

  const daliJobPays = [...jobAggs.values()]
    .filter((agg) => classifyJob(agg.jobId, byJobCode).category !== "External")
    .map((agg) => agg.pay);

  const summary: CollationSummary = {
    daliHours,
    daliPay,
    externalHours,
    externalPay,
    totalHours: daliHours + externalHours,
    totalPay: daliPay + externalPay,
    daliStudentCount: daliStudents.size,
    medianPay: median(daliJobPays),
  };

  return {
    projects: projectSummaries,
    core: rollup("Core", coreJobs),
    instructor: rollup("Instructor", instructorJobs),
    external: rollup("External", externalJobs),
    chartStrings,
    discrepancies: {
      assignedNoHours,
      unassignedJobs,
      rateMismatches,
      unknownPersons,
    },
    summary,
  };
}

/**
 * Infer the likely project for an unassigned DALI Project job:
 *   1. charged chart string suffix → exactly one project, else
 *   2. another *assigned* holder of the same jobId → exactly one project, else
 *   3. null.
 */
function inferProject(
  agg: { jobId: string; chartStrings: Set<string> },
  projectsByChartSuffix: Map<string, Set<string>>,
  projectById: Map<string, CollationProject>,
  assignedProjectsByJobId: Map<string, Set<string>>,
): { id: string | null; name: string | null } {
  for (const cs of agg.chartStrings) {
    const ids = projectsByChartSuffix.get(normalizeChartSuffix(cs));
    if (ids && ids.size === 1) {
      const p = projectById.get([...ids][0]);
      if (p) return { id: p.id, name: p.name };
    }
  }
  const holderProjects = assignedProjectsByJobId.get(agg.jobId);
  if (holderProjects && holderProjects.size === 1) {
    const p = projectById.get([...holderProjects][0]);
    if (p) return { id: p.id, name: p.name };
  }
  return { id: null, name: null };
}
