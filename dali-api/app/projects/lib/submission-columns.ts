// Pure assembly of a staffing slot's "database view": given the saved column
// mapping and a set of submissions whose answer values have ALREADY been
// resolved to display strings (reference ids → names, builtins → text by the
// loader, which owns the DB), produce the ordered column list and each row's
// cells. Splitting this out keeps ordering/visibility logic exhaustively
// unit-testable, like the interpreters.
//
// The mapping is the single source of truth for which columns exist, their
// order, labels, and visibility. With no mapping there are simply no mapped
// columns (the loader still lists the rows — every submission is recorded
// regardless of mapping; see public-form.ts).

import type { ColumnMapping, ColumnMappingEntry } from "./slot-roles";

// A stable per-column key. Question columns key by questionKey (+termId for
// per-term roles); builtin columns key by the builtin name. Repeated roles
// (the 3 ranked project columns) stay distinct because each maps a different
// question, hence a different questionKey.
export function columnKey(e: ColumnMappingEntry): string {
  const base =
    e.source === "builtin" ? `builtin:${e.builtin}` : `q:${e.questionKey}`;
  return e.termId ? `${base}@${e.termId}` : base;
}

export type ColumnDescriptor = {
  key: string;
  label: string;
  hidden: boolean;
  source: "question" | "builtin";
  // For builtin columns the loader needs to know which builtin to resolve.
  builtin?: string;
  questionKey?: string;
  termId?: string;
};

// Columns in the manager's chosen order. `hidden` ones are excluded from the
// default table but the detail page shows them, so both are returned and the
// consumer decides per surface.
export function orderedColumns(
  mapping: ColumnMapping | null,
): ColumnDescriptor[] {
  if (!mapping) return [];
  return [...mapping.entries]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((e) => ({
      key: columnKey(e),
      label: e.label,
      hidden: e.hidden === true,
      source: e.source,
      ...(e.source === "builtin"
        ? { builtin: e.builtin }
        : { questionKey: e.questionKey }),
      ...(e.termId ? { termId: e.termId } : {}),
    }));
}

export const visibleColumns = (m: ColumnMapping | null): ColumnDescriptor[] =>
  orderedColumns(m).filter((c) => !c.hidden);

// Build one row's cell map (columnKey → display string) from the resolved
// values the loader supplies. `answerText` covers question columns (already
// stringified / name-resolved); `builtinText` covers builtin columns
// (submitter, hiredRoles). A column with no value renders blank, not missing.
export function rowCells(
  mapping: ColumnMapping | null,
  resolved: {
    answerText: Record<string, string>; // by questionKey
    builtinText: Record<string, string>; // by builtin name
  },
): Record<string, string> {
  const cells: Record<string, string> = {};
  for (const c of orderedColumns(mapping)) {
    if (c.source === "builtin") {
      cells[c.key] = resolved.builtinText[c.builtin ?? ""] ?? "";
    } else {
      cells[c.key] = resolved.answerText[c.questionKey ?? ""] ?? "";
    }
  }
  return cells;
}
