// MCP `list_project_chart_strings` / `set_project_chart_string` — Core-only
// read and write for a project's payroll chart strings, with history.
//
// Why these aren't fields on get_project_settings / update_project: those are
// member-accessible (Core OR anyone staffed on the project), and chart strings
// are Dartmouth payroll GL codes that only Core has reason to see. The write
// also takes `mcp:admin` rather than `mcp:write`, so a client trusted to edit
// tasks doesn't silently inherit the ability to move payroll.
//
// Resolution has two layers. A project may hold its own row for a term; if it
// doesn't, it inherits the lab-wide default for that term (the row with a NULL
// projectId). Twenty projects charge the same lab GL string, so writing it per
// project per term would relocate the transcription problem rather than end it
// — hence the default, and hence `source` on every effective answer, because a
// caller that can't tell inherited from explicit will eventually confuse them.

import { prisma } from "~/lib/db";
import { isCore, isAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { parseChartString, type ChartStringType } from "~/lib/chart-string";
import { McpForbiddenError, McpNotFoundError, McpInvalidError } from "./errors";

const CHART_STRING_KINDS = ["ADVANCE", "FUNDED", "DEPARTMENT"] as const;
type ChartStringKind = (typeof CHART_STRING_KINDS)[number];

async function requireCore(callerId: string): Promise<void> {
  const [core, admin] = await Promise.all([isCore(callerId), isAdmin(callerId)]);
  if (!core && !admin) {
    throw new McpForbiddenError(
      "Only Core leads or admins can read or write project chart strings.",
    );
  }
}

// ─── list_project_chart_strings ──────────────────────────────────────────────

export const LIST_PROJECT_CHART_STRINGS_TOOL = {
  name: "list_project_chart_strings",
  description:
    "Read a project's payroll chart strings for one term or all terms, including superseded history. Returns both the project's own entries and the effective string per term, which may be inherited from the lab-wide default. Core-only; chart strings are deliberately absent from `get_project_settings`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: {
        type: "string",
        minLength: 1,
        description: "Project.id, as returned by `list_projects` or `list_my_projects`.",
      },
      termCode: {
        type: "string",
        description: "Limit to one term, e.g. '26F'. Omit for every term on record.",
      },
      includeSuperseded: {
        type: "boolean",
        description:
          "Include rows replaced by a later one. Default false (current rows only).",
      },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export type ChartStringEntry = {
  id: string;
  termCode: string;
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
  awardStart: string | null;
  awardEnd: string | null;
  kind: ChartStringKind;
  isCurrent: boolean;
  supersedesId: string | null;
  supersedeReason: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
};

export type EffectiveChartString = {
  termCode: string;
  /** Where the answer came from — an explicit row, the lab default, or nothing. */
  source: "project" | "labDefault" | "none";
  chartString: string | null;
  type: ChartStringType | null;
  projectCode: string | null;
};

type Row = {
  id: string;
  projectId: string | null;
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
  awardStart: Date | null;
  awardEnd: Date | null;
  kind: ChartStringKind;
  isCurrent: boolean;
  supersedesId: string | null;
  supersedeReason: string | null;
  note: string | null;
  createdAt: Date;
  term: { code: string; sortKey: number };
  createdBy: { firstName: string; lastName: string } | null;
};

function toEntry(r: Row): ChartStringEntry {
  return {
    id: r.id,
    termCode: r.term.code,
    raw: r.raw,
    normalized: r.normalized,
    type: r.type,
    projectCode: r.projectCode,
    subactivity: r.subactivity,
    org: r.org,
    awardCode: r.awardCode,
    fpNumber: r.fpNumber,
    awardId: r.awardId,
    rapportName: r.rapportName,
    awardStart: r.awardStart?.toISOString() ?? null,
    awardEnd: r.awardEnd?.toISOString() ?? null,
    kind: r.kind,
    isCurrent: r.isCurrent,
    supersedesId: r.supersedesId,
    supersedeReason: r.supersedeReason,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy
      ? `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim()
      : null,
  };
}

export async function runListProjectChartStrings(
  callerId: string,
  input: { projectId: string; termCode?: string; includeSuperseded?: boolean },
): Promise<{
  project: { id: string; name: string };
  entries: ChartStringEntry[];
  effective: EffectiveChartString[];
}> {
  await requireCore(callerId);

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, name: true },
  });
  if (!project) throw new McpNotFoundError(`Project ${input.projectId} not found.`);

  const termFilter = input.termCode ? { term: { code: input.termCode } } : {};
  const select = {
    id: true,
    projectId: true,
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
    awardStart: true,
    awardEnd: true,
    kind: true,
    isCurrent: true,
    supersedesId: true,
    supersedeReason: true,
    note: true,
    createdAt: true,
    term: { select: { code: true, sortKey: true } },
    createdBy: { select: { firstName: true, lastName: true } },
  } as const;

  // The project's own rows, and the lab defaults, fetched together so the
  // effective answer for a term can fall back without a second round trip.
  const [own, defaults] = await Promise.all([
    prisma.projectChartString.findMany({
      where: {
        projectId: input.projectId,
        ...termFilter,
        ...(input.includeSuperseded ? {} : { isCurrent: true }),
      },
      select,
    }),
    prisma.projectChartString.findMany({
      where: { projectId: null, isCurrent: true, ...termFilter },
      select,
    }),
  ]);

  const ownRows = own as unknown as Row[];
  const defaultRows = defaults as unknown as Row[];

  const currentOwnByTerm = new Map<string, Row>();
  for (const r of ownRows) if (r.isCurrent) currentOwnByTerm.set(r.term.code, r);
  const defaultByTerm = new Map<string, Row>();
  for (const r of defaultRows) defaultByTerm.set(r.term.code, r);

  const termCodes = input.termCode
    ? [input.termCode]
    : [...new Set([...currentOwnByTerm.keys(), ...defaultByTerm.keys()])];

  const sortKey = new Map<string, number>();
  for (const r of [...ownRows, ...defaultRows]) sortKey.set(r.term.code, r.term.sortKey);

  const effective: EffectiveChartString[] = termCodes
    .sort((a, b) => (sortKey.get(a) ?? 0) - (sortKey.get(b) ?? 0))
    .map((termCode) => {
      const hit = currentOwnByTerm.get(termCode) ?? defaultByTerm.get(termCode);
      if (!hit) {
        return { termCode, source: "none" as const, chartString: null, type: null, projectCode: null };
      }
      return {
        termCode,
        source: hit.projectId ? ("project" as const) : ("labDefault" as const),
        chartString: hit.normalized,
        type: hit.type,
        projectCode: hit.projectCode,
      };
    });

  return {
    project,
    entries: ownRows
      .sort(
        (a, b) =>
          a.term.sortKey - b.term.sortKey ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      )
      .map(toEntry),
    effective,
  };
}

// ─── set_project_chart_string ────────────────────────────────────────────────

export const SET_PROJECT_CHART_STRING_TOOL = {
  name: "set_project_chart_string",
  description:
    "Record a payroll chart string for a project and term. Appends a new row and marks any existing current row for that project/term superseded — nothing is edited in place, so the history is the audit trail. Validates the string's format (GL or PTAEO) and rejects malformed values. Core-only, and requires the `mcp:admin` scope.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: {
        type: "string",
        minLength: 1,
        description:
          "Project.id. Required and explicit: resolving a project from an award title is the caller's job, not this tool's — a payroll identifier should not be written off a fuzzy name match.",
      },
      termCode: {
        type: "string",
        minLength: 1,
        description: "Term this string applies to, e.g. '26F'. One row per term.",
      },
      chartString: {
        type: "string",
        minLength: 1,
        description:
          "The chart string as received. GL is entity.org.funding.activity.subactivity; PTAEO is project.task.award.expenditureType.org, where XXXXX in the expenditure type is expected and correct.",
      },
      kind: {
        type: "string",
        enum: [...CHART_STRING_KINDS],
        description:
          "ADVANCE (advance account while the FP routes), FUNDED (the funded award), or DEPARTMENT (a departmental GL line). Default FUNDED.",
      },
      fpNumber: { type: "string", description: "RAPPORT FP, e.g. FP00014787." },
      awardId: { type: "string", description: "RAPPORT award, e.g. AWD00013615." },
      rapportName: {
        type: "string",
        description:
          "The award's title in RAPPORT, which is rarely identical to the DALI OS project name. Stored as provenance.",
      },
      awardStart: { type: "string", description: "Award start date (ISO)." },
      awardEnd: { type: "string", description: "Award end date (ISO)." },
      supersedeReason: {
        type: "string",
        description:
          "Why this replaces the previous row, e.g. 'advance -> funded award'.",
      },
      note: { type: "string", description: "Free-text note." },
    },
    required: ["projectId", "termCode", "chartString"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

export type SetChartStringResult = {
  ok: true;
  id: string;
  termCode: string;
  normalized: string;
  type: ChartStringType;
  projectCode: string;
  supersededId: string | null;
  /** Format issues that didn't block the write — an unknown subactivity, a
   *  pre-migration org. Surfaced so the caller can repeat them to a human. */
  warnings: { code: string; message: string }[];
};

export async function runSetProjectChartString(
  callerId: string,
  input: {
    projectId: string;
    termCode: string;
    chartString: string;
    kind?: ChartStringKind;
    fpNumber?: string;
    awardId?: string;
    rapportName?: string;
    awardStart?: string;
    awardEnd?: string;
    supersedeReason?: string;
    note?: string;
  },
): Promise<SetChartStringResult> {
  await requireCore(callerId);

  const [project, term] = await Promise.all([
    prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, name: true },
    }),
    prisma.term.findUnique({
      where: { code: input.termCode },
      select: { id: true, code: true },
    }),
  ]);
  if (!project) throw new McpNotFoundError(`Project ${input.projectId} not found.`);
  if (!term) throw new McpNotFoundError(`Term ${input.termCode} not found.`);

  const parsed = parseChartString(input.chartString);
  if (parsed.errors.length > 0 || !parsed.type || !parsed.projectCode) {
    throw new McpInvalidError(
      `Invalid chart string: ${parsed.errors.map((e) => e.message).join(" ")}`,
    );
  }

  const awardStart = parseDate(input.awardStart, "awardStart");
  const awardEnd = parseDate(input.awardEnd, "awardEnd");

  // Deactivate-then-insert, in that order and in one transaction: the partial
  // unique index permits exactly one current row per (project, term), so the
  // old row has to stop being current before the new one exists. `supersedesId`
  // then points backwards from the replacement, which means no row's own
  // history is ever rewritten — only its current flag is cleared.
  const created = await prisma.$transaction(async (tx) => {
    const previous = await tx.projectChartString.findFirst({
      where: { projectId: project.id, termId: term.id, isCurrent: true },
      select: { id: true },
    });

    if (previous) {
      await tx.projectChartString.update({
        where: { id: previous.id },
        data: { isCurrent: false },
      });
    }

    return tx.projectChartString.create({
      data: {
        projectId: project.id,
        termId: term.id,
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
        awardStart,
        awardEnd,
        kind: input.kind ?? "FUNDED",
        isCurrent: true,
        supersedesId: previous?.id ?? null,
        supersedeReason: previous ? input.supersedeReason?.trim() || null : null,
        note: input.note?.trim() || null,
        createdById: callerId,
      },
      select: { id: true, supersedesId: true },
    });
  });

  await logAuditEvent({
    action: "project.chart-string.set",
    userId: callerId,
    targetId: project.id,
    metadata: {
      termCode: term.code,
      chartString: parsed.normalized,
      type: parsed.type,
      kind: input.kind ?? "FUNDED",
      supersededId: created.supersedesId,
      warnings: parsed.warnings.map((w) => w.code),
    },
  });

  return {
    ok: true,
    id: created.id,
    termCode: term.code,
    normalized: parsed.normalized,
    type: parsed.type as ChartStringType,
    projectCode: parsed.projectCode as string,
    supersededId: created.supersedesId,
    warnings: parsed.warnings,
  };
}

function parseDate(value: string | undefined, field: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new McpInvalidError(`${field} is not a valid date.`);
  }
  return d;
}
