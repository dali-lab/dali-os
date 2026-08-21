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
