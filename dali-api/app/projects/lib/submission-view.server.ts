// Server-side resolver shared by the Project Bids / Intent to Work boards and
// their per-submission detail pages. Turns raw FormSubmission rows into the
// view model the SubmissionDatabase component renders: ordered columns + each
// row's resolved cell strings. DB lookups live here; the ordering/visibility
// logic is the pure submission-columns.ts.

import { prisma } from "~/lib/db";
import type { Question } from "~/types";
import type { Slot } from "./form-slots";
import { parseColumnMapping, type ColumnMapping } from "./slot-roles";
import {
  orderedColumns,
  rowCells,
  visibleColumns,
  type ColumnDescriptor,
} from "./submission-columns";

export type ResolvedRow = {
  userId: string;
  name: string;
  email: string | null;
  // Domain ids the member has eligibility in — used by the board's domain
  // filter dropdown. Order is whatever DomainEligibility returns.
  domainIds: string[];
  // columnKey → display string, for every (incl. hidden) mapped column.
  // Drives the board table.
  cells: Record<string, string>;
  // Every field this submission contains, in form order: each form question
  // first, then the always-on builtins (submitter, hiredRoles). Drives the
  // detail page so it shows raw form answers even when no column mapping is
  // configured. Populated for every row — cheap, and lets callers render the
  // detail view without a second query.
  detailFields: DetailField[];
};

// One row's worth of "everything we know about this submission" for the
// detail page. `mapped` reports whether the manager's column mapping
// includes this field at all (table or hidden) — purely informational; the
// detail page shows everything regardless.
export type DetailField = {
  key: string;
  label: string;
  value: string;
  source: "question" | "builtin";
  mapped: boolean;
};

export type SubmissionView = {
  mapping: ColumnMapping | null;
  // All columns in order (detail page) and the table subset (board).
  allColumns: ColumnDescriptor[];
  tableColumns: ColumnDescriptor[];
  rows: ResolvedRow[];
};

function stringifyAnswer(
  q: Question | undefined,
  raw: unknown,
  refName: (id: string) => string | undefined,
): string {
  if (raw == null || raw === "") return "";
  if (q?.type === "reference") {
    if (typeof raw === "string") return refName(raw) ?? raw;
    return "";
  }
  if (Array.isArray(raw)) return raw.map((v) => String(v)).join(", ");
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}

// Build the full view for one cycle (or several, for the all-terms aggregate)
// + slot. `userId`, when given, narrows to a single member's submission (the
// detail page).
export async function buildSubmissionView(args: {
  cycleIds: string[];
  slot: Slot;
  formId: string | null;
  userId?: string;
}): Promise<SubmissionView> {
  const { cycleIds, slot, formId } = args;

  const mapping = formId
    ? await prisma.staffingCycleFormBinding
        .findFirst({
          where: { formId, slot, staffingCycleId: { in: cycleIds } },
          select: { columnMapping: true },
        })
        .then((b) => parseColumnMapping(b?.columnMapping ?? null))
    : null;

  // Latest version's questions, to know each answer's type (reference vs not).
  const questions: Question[] = formId
    ? await prisma.formVersion
        .findFirst({
          where: { form: { id: formId } },
          orderBy: { versionNumber: "desc" },
          select: { questions: true },
        })
        .then((v) => (v?.questions as unknown as Question[]) ?? [])
    : [];
  const qByKey = new Map(questions.map((q) => [q.key, q]));

  const subs = await prisma.formSubmission.findMany({
    where: {
      staffingCycleId: { in: cycleIds },
      slot,
      userId: args.userId ? args.userId : { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: {
      userId: true,
      answers: true,
      user: { select: { firstName: true, lastName: true, daliEmail: true } },
    },
  });
  // One row per member: the most recent submission wins (createdAt desc, so
  // the first seen for a user is newest — matches replace-on-resubmit).
  const seen = new Set<string>();
  const rowsRaw = subs.filter((s) => {
    if (!s.userId || seen.has(s.userId)) return false;
    seen.add(s.userId);
    return true;
  });

  // Batch-resolve reference answers (project/domain ids → names) across all
  // rows, and the hiredRoles builtin (the member's DomainEligibility).
  const refIds = new Set<string>();
  for (const s of rowsRaw) {
    const ans = (s.answers as Record<string, unknown>) ?? {};
    for (const q of questions) {
      if (q.type !== "reference") continue;
      const v = ans[q.key];
      if (typeof v === "string" && v) refIds.add(v);
    }
  }
  const idList = [...refIds];
  const [projects, domains, eligibilities] = await Promise.all([
    idList.length
      ? prisma.project.findMany({
          where: { id: { in: idList } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    idList.length
      ? prisma.domain.findMany({
          where: { id: { in: idList } },
          select: { id: true, displayName: true },
        })
      : Promise.resolve([]),
    prisma.domainEligibility.findMany({
      where: { userId: { in: rowsRaw.map((r) => r.userId!) } },
      select: {
        userId: true,
        level: true,
        domainId: true,
        domain: { select: { displayName: true } },
      },
    }),
  ]);
  const refName = new Map<string, string>();
  for (const p of projects) refName.set(p.id, p.name);
  for (const d of domains) refName.set(d.id, d.displayName);
  const hiredByUser = new Map<string, string>();
  const domainIdsByUser = new Map<string, string[]>();
  for (const e of eligibilities) {
    const txt = `${e.domain.displayName} (${e.level})`;
    hiredByUser.set(
      e.userId,
      hiredByUser.has(e.userId)
        ? `${hiredByUser.get(e.userId)}, ${txt}`
        : txt,
    );
    const ids = domainIdsByUser.get(e.userId) ?? [];
    ids.push(e.domainId);
    domainIdsByUser.set(e.userId, ids);
  }

  // Which form-question keys / builtins the mapping covers — used to flag
  // each detail field as mapped vs not. The detail page renders both either
  // way, the flag is informational.
  const mappedQuestionKeys = new Set<string>();
  const mappedBuiltins = new Set<string>();
  if (mapping) {
    for (const e of mapping.entries) {
      if (e.source === "question") mappedQuestionKeys.add(e.questionKey);
      else mappedBuiltins.add(e.builtin);
    }
  }
  // Builtin labels for the detail view. Kept short; the mapping can rename
  // them in the table without renaming them here.
  const BUILTIN_LABELS: Record<string, string> = {
    submitter: "Submitter",
    hiredRoles: "Hired roles",
  };

  const rows: ResolvedRow[] = rowsRaw.map((s) => {
    const ans = (s.answers as Record<string, unknown>) ?? {};
    const answerText: Record<string, string> = {};
    for (const q of questions) {
      answerText[q.key] = stringifyAnswer(qByKey.get(q.key), ans[q.key], (id) =>
        refName.get(id),
      );
    }
    const builtinText: Record<string, string> = {
      submitter: `${s.user!.firstName} ${s.user!.lastName}`,
      hiredRoles: hiredByUser.get(s.userId!) ?? "",
    };

    // Detail-page field list: every question in form order, then builtins.
    // Independent of the column mapping so partial / missing mappings still
    // show every answer the form actually has.
    const detailFields: DetailField[] = [
      ...questions.map((q) => ({
        key: `q:${q.key}`,
        label: q.data.label,
        value: answerText[q.key] ?? "",
        source: "question" as const,
        mapped: mappedQuestionKeys.has(q.key),
      })),
      ...Object.keys(BUILTIN_LABELS).map((b) => ({
        key: `builtin:${b}`,
        label: BUILTIN_LABELS[b],
        value: builtinText[b] ?? "",
        source: "builtin" as const,
        mapped: mappedBuiltins.has(b),
      })),
    ];

    return {
      userId: s.userId!,
      name: `${s.user!.firstName} ${s.user!.lastName}`,
      email: s.user!.daliEmail,
      domainIds: domainIdsByUser.get(s.userId!) ?? [],
      cells: rowCells(mapping, { answerText, builtinText }),
      detailFields,
    };
  });

  rows.sort((a, b) => a.name.localeCompare(b.name));

  return {
    mapping,
    allColumns: orderedColumns(mapping),
    tableColumns: visibleColumns(mapping),
    rows,
  };
}
