// Client-safe term-filter vocabulary. Kept separate from ~/lib/terms (which
// imports Prisma via resolveTermFilter) so client components like TermFilter
// can use the sentinel/type without dragging the Prisma client — and its
// node:url dependency — into the browser bundle.

// Sentinel used by the term-filter dropdown for the "All terms" choice. Kept
// here so loaders and the TermFilter component agree on the wire value.
export const ALL_TERMS = "all" as const;

// `isCurrent` marks the term currentTerm() resolves to, so the dropdown can
// float it to the top without every caller having to thread the id through its
// loader. Optional: options built by hand (tests, fixtures) simply have none.
export type TermOption = { id: string; code: string; isCurrent?: boolean };

/**
 * Display order for the term dropdown: the "All terms" escape hatch first, then
 * the current term, then back through history. Reading order, not sort order —
 * `terms` itself stays in sortKey-desc order for callers that index it (e.g.
 * education.compliance's "newest term" fallback).
 *
 * Terms newer than the current one keep their place in the descending tail
 * rather than jumping the current term: a future cycle that exists in the DB
 * shouldn't outrank the term you're actually in.
 */
export function termFilterOrder(
  terms: TermOption[],
): { value: string; label: string }[] {
  const current = terms.find((t) => t.isCurrent);
  return [
    { value: ALL_TERMS, label: "All terms" },
    ...(current ? [{ value: current.id, label: current.code }] : []),
    ...terms
      .filter((t) => t.id !== current?.id)
      .map((t) => ({ value: t.id, label: t.code })),
  ];
}

// Dartmouth term seasons in academic order within a year: Winter, Spring,
// Summer (X), Fall. The term after Fall rolls into the next year's Winter.
const TERM_SEASON_ORDER = ["W", "S", "X", "F"] as const;

// The term code immediately following `code` — e.g. "26S" → "26X", "26F" → "27W".
// Pure string arithmetic: it does NOT require the next Term row to exist, so the
// {{upcomingTerm}} signing variable resolves even before that term is seeded.
// Returns "" for an unrecognized code so callers fall back to a blank value.
export function nextTermCode(code: string): string {
  const match = /^(\d{2})([WSXF])$/.exec(code.trim().toUpperCase());
  if (!match) return "";
  const [, yy, season] = match;
  const idx = TERM_SEASON_ORDER.indexOf(season as (typeof TERM_SEASON_ORDER)[number]);
  if (idx === TERM_SEASON_ORDER.length - 1) {
    return `${String((Number(yy) + 1) % 100).padStart(2, "0")}W`;
  }
  return `${yy}${TERM_SEASON_ORDER[idx + 1]}`;
}
