// The one write path for project chart strings, shared by the project detail
// form and the `set_project_chart_string` MCP tool. Both callers validate the
// same way, supersede the same way, mirror the same way and audit the same way
// — a second implementation is how the two would drift.
//
// Transitional mirror: `Project.chartString` / `chartStringType` still drive
// the payroll export, the collation seam, the Admin → Payroll "missing chart
// string" warning and the seed. Until those readers move to this table, a write
// for the *current* term also mirrors into those columns, so entering a chart
// string here reaches payroll instead of landing somewhere nothing reads. The
// mirror comes out when the readers are repointed, and the columns are dropped
// after that.

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { currentTerm } from "~/lib/roles";
import {
  parseChartString,
  type ChartStringType,
  type ChartStringIssue,
} from "~/lib/chart-string";

export const CHART_STRING_KINDS = ["ADVANCE", "FUNDED", "DEPARTMENT"] as const;
export type ChartStringKind = (typeof CHART_STRING_KINDS)[number];

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
  kind?: ChartStringKind;
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
  /** True when this write also updated the legacy Project columns. */
  mirrored: boolean;
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

  const active = await currentTerm();
  const isCurrentTerm = active?.id === input.termId;

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
        kind: input.kind ?? "FUNDED",
        isCurrent: true,
        supersedesId: previous?.id ?? null,
        supersedeReason: previous ? input.supersedeReason?.trim() || null : null,
        note: input.note?.trim() || null,
        createdById: input.createdById,
      },
      select: { id: true, supersedesId: true },
    });

    // Only the current term mirrors: Project.chartString has no term, so
    // writing a past or future term's string into it would overwrite what
    // payroll is charging right now.
    if (isCurrentTerm) {
      await tx.project.update({
        where: { id: input.projectId },
        data: {
          chartString: parsed.normalized,
          chartStringType: parsed.type,
        },
      });
    }

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
      kind: input.kind ?? "FUNDED",
      supersededId: created.supersedesId,
      mirrored: isCurrentTerm,
      warnings: parsed.warnings.map((w) => w.code),
    },
  });

  return {
    id: created.id,
    supersededId: created.supersedesId,
    normalized: parsed.normalized,
    type: parsed.type as ChartStringType,
    projectCode: parsed.projectCode as string,
    mirrored: isCurrentTerm,
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
  kind: ChartStringKind;
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
      kind: true,
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
    kind: r.kind as ChartStringKind,
    isCurrent: r.isCurrent,
    supersedeReason: r.supersedeReason,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy
      ? `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim()
      : null,
  }));
}
