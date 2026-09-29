// The one write path for project chart strings, shared by the project detail
// form and the `set_project_chart_string` MCP tool, and the one read path the
// payroll export and the collation seam resolve through. Both writers validate,
// supersede and audit the same way — a second implementation is how the two
// would drift.
//
// This table is the only source. The legacy `Project.chartString` columns were
// imported into it (migration chart_string_legacy_backfill) and nothing reads
// them any more.

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import {
  DALI_PROJECTS_GL,
  parseChartString,
  type ChartStringType,
  type ChartStringIssue,
  type ProjectFundingType,
} from "~/lib/chart-string";

// Re-exported so server callers keep one import; the values themselves live in
// the client-safe module so the project panel can render the dropdown.
export {
  PROJECT_FUNDING_TYPES,
  PROJECT_FUNDING_TYPE_LABELS,
  type ProjectFundingType,
} from "~/lib/chart-string";


export class ChartStringValidationError extends Error {
  status = 400;
  issues: ChartStringIssue[];
  constructor(issues: ChartStringIssue[]) {
    super(issues.map((i) => i.message).join(" "));
    this.name = "ChartStringValidationError";
    this.issues = issues;
  }
}

export type RecordChartStringInput = {
  projectId: string;
  termId: string;
  chartString: string;
  fundingType?: ProjectFundingType | null;
  fpNumber?: string | null;
  awardId?: string | null;
  rapportName?: string | null;
  awardStart?: Date | null;
  awardEnd?: Date | null;
  supersedeReason?: string | null;
  note?: string | null;
  createdById: string;
};

export type RecordChartStringResult = {
  id: string;
  supersededId: string | null;
  normalized: string;
  type: ChartStringType;
  projectCode: string;
  /** Format issues that didn't block the write. */
  warnings: ChartStringIssue[];
};

/**
 * Append a chart string row for (project, term), superseding whatever was
 * current. Throws ChartStringValidationError when the string can't be parsed.
 */
export async function recordProjectChartString(
  input: RecordChartStringInput,
): Promise<RecordChartStringResult> {
  const parsed = parseChartString(input.chartString);
  if (parsed.errors.length > 0 || !parsed.type || !parsed.projectCode) {
    throw new ChartStringValidationError(
      parsed.errors.length > 0
        ? parsed.errors
        : [{ code: "unparsed", message: "Chart string could not be parsed." }],
    );
  }

  // Deactivate-then-insert, in one transaction and in that order: the partial
  // unique index permits one current row per (project, term), so the old row
  // must stop being current before the new one exists. Pointing the new row
  // back at the old one means no existing row's history is rewritten.
  const created = await prisma.$transaction(async (tx) => {
    const previous = await tx.projectChartString.findFirst({
      where: { projectId: input.projectId, termId: input.termId, isCurrent: true },
      select: { id: true },
    });

    if (previous) {
      await tx.projectChartString.update({
        where: { id: previous.id },
        data: { isCurrent: false },
      });
    }

    const row = await tx.projectChartString.create({
      data: {
        projectId: input.projectId,
        termId: input.termId,
        raw: input.chartString,
        normalized: parsed.normalized,
        type: parsed.type as ChartStringType,
        projectCode: parsed.projectCode as string,
        subactivity: parsed.subactivity,
        org: parsed.org,
        awardCode: parsed.awardCode,
        fpNumber: input.fpNumber?.trim() || null,
        awardId: input.awardId?.trim() || null,
        rapportName: input.rapportName?.trim() || null,
        awardStart: input.awardStart ?? null,
        awardEnd: input.awardEnd ?? null,
        fundingType: input.fundingType ?? null,
        isCurrent: true,
        supersedesId: previous?.id ?? null,
        supersedeReason: previous ? input.supersedeReason?.trim() || null : null,
        note: input.note?.trim() || null,
        createdById: input.createdById,
      },
      select: { id: true, supersedesId: true },
    });

    return row;
  });

  await logAuditEvent({
    action: "project.chart-string.set",
    userId: input.createdById,
    targetId: input.projectId,
    metadata: {
      termId: input.termId,
      chartString: parsed.normalized,
      type: parsed.type,
      fundingType: input.fundingType ?? null,
      supersededId: created.supersedesId,
      warnings: parsed.warnings.map((w) => w.code),
    },
  });

  return {
    id: created.id,
    supersededId: created.supersedesId,
    normalized: parsed.normalized,
    type: parsed.type as ChartStringType,
    projectCode: parsed.projectCode as string,
    warnings: parsed.warnings,
  };
}

export type ChartStringRow = {
  id: string;
  termId: string;
  termCode: string;
  termSortKey: number;
  raw: string;
  normalized: string;
  type: ChartStringType;
  projectCode: string;
  subactivity: string | null;
  org: string | null;
  awardCode: string | null;
  fpNumber: string | null;
  awardId: string | null;
  rapportName: string | null;
  fundingType: ProjectFundingType | null;
  isCurrent: boolean;
  supersedeReason: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
};

/** Every row for a project, newest term first, current before superseded. */
export async function listProjectChartStrings(
  projectId: string,
): Promise<ChartStringRow[]> {
  const rows = await prisma.projectChartString.findMany({
    where: { projectId },
    select: {
      id: true,
      termId: true,
      raw: true,
      normalized: true,
      type: true,
      projectCode: true,
      subactivity: true,
      org: true,
      awardCode: true,
      fpNumber: true,
      awardId: true,
      rapportName: true,
      fundingType: true,
      isCurrent: true,
      supersedeReason: true,
      note: true,
      createdAt: true,
      term: { select: { code: true, sortKey: true } },
      createdBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ term: { sortKey: "desc" } }, { createdAt: "desc" }],
  });

  return rows.map((r) => ({
    id: r.id,
    termId: r.termId,
    termCode: r.term.code,
    termSortKey: r.term.sortKey,
    raw: r.raw,
    normalized: r.normalized,
    type: r.type as ChartStringType,
    projectCode: r.projectCode,
    subactivity: r.subactivity,
    org: r.org,
    awardCode: r.awardCode,
    fpNumber: r.fpNumber,
    awardId: r.awardId,
    rapportName: r.rapportName,
    fundingType: r.fundingType as ProjectFundingType | null,
    isCurrent: r.isCurrent,
    supersedeReason: r.supersedeReason,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy
      ? `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim()
      : null,
  }));
}

export type ResolvedChartString = {
  normalized: string;
  type: ChartStringType;
  /** Who supplied it: the project's own row for the term, the lab-wide default
   *  row for the term, or — when the lab hasn't recorded one — the lab's
   *  projects GL built into the code. */
  source: "project" | "labDefault" | "builtIn";
  /** Set only when the project didn't supply this term's string: the latest
   *  other term in which it did. A sponsored project nobody re-entered for the
   *  new term falls back to the lab GL without complaint, so callers warn on
   *  this. */
  lastOwnTermCode: string | null;
};

/**
 * The chart string each project charges in a term. Every project gets an
 * answer — inheriting is the normal case for the projects on the lab GL — so
 * a missing entry means only that the id wasn't passed in.
 */
export async function resolveChartStringsForTerm(
  termId: string,
  projectIds: string[],
): Promise<Map<string, ResolvedChartString>> {
  const ids = [...new Set(projectIds)];
  const [own, labDefault] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([])
      : prisma.projectChartString.findMany({
          where: { projectId: { in: ids }, isCurrent: true },
          select: {
            projectId: true,
            termId: true,
            normalized: true,
            type: true,
            term: { select: { code: true, sortKey: true } },
          },
        }),
    prisma.projectChartString.findFirst({
      where: { projectId: null, termId, isCurrent: true },
      select: { normalized: true, type: true },
    }),
  ]);

  const inherited = labDefault
    ? { normalized: labDefault.normalized, type: labDefault.type as ChartStringType, source: "labDefault" as const }
    : { normalized: DALI_PROJECTS_GL, type: "GL" as const, source: "builtIn" as const };

  const thisTerm = new Map<string, { normalized: string; type: ChartStringType }>();
  const latestOther = new Map<string, { code: string; sortKey: number }>();
  for (const r of own) {
    if (!r.projectId) continue;
    if (r.termId === termId) {
      thisTerm.set(r.projectId, { normalized: r.normalized, type: r.type as ChartStringType });
    } else if ((latestOther.get(r.projectId)?.sortKey ?? -Infinity) < r.term.sortKey) {
      latestOther.set(r.projectId, r.term);
    }
  }

  const out = new Map<string, ResolvedChartString>();
  for (const id of ids) {
    const mine = thisTerm.get(id);
    out.set(
      id,
      mine
        ? { ...mine, source: "project", lastOwnTermCode: null }
        : { ...inherited, lastOwnTermCode: latestOther.get(id)?.code ?? null },
    );
  }
  return out;
}

/**
 * Every chart string each project has held, in any term, current or
 * superseded — for matching the strings timesheets were actually charged
 * against, which can be months older than whatever is current now.
 */
export async function listChartStringsByProject(): Promise<Map<string, string[]>> {
  const rows = await prisma.projectChartString.findMany({
    where: { projectId: { not: null } },
    select: { projectId: true, normalized: true },
  });
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = out.get(r.projectId as string) ?? new Set<string>();
    set.add(r.normalized);
    out.set(r.projectId as string, set);
  }
  return new Map([...out].map(([id, set]) => [id, [...set]]));
}
