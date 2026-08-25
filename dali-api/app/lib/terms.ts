import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";

// Re-exported for existing server-side importers. The definitions live in
// terms.shared so client components (TermFilter) can import them without
// pulling Prisma into the browser bundle.
export { ALL_TERMS, UPCOMING, type TermOption } from "~/lib/terms.shared";
import { ALL_TERMS, UPCOMING, type TermOption } from "~/lib/terms.shared";

/**
 * Resolves the term-filter state for a loader from the `?term=` search param,
 * shared by every page with a TermFilter dropdown.
 *
 * - No param → the `opts.default` scope: "current" (default) or "upcoming".
 * - `?term=all` → the "All terms" view (termId/termIds null, isAll true).
 * - `?term=upcoming` → the current term plus every future term (isUpcoming,
 *   termIds is the id set to filter by, termId null).
 * - `?term=<id>` → that single term, if it exists; otherwise falls back to the
 *   default scope.
 *
 * `termIds` is the ready-to-use id set for a `where: { termId: { in } }` clause:
 * `[id]` for a single term, the current+future set for "upcoming", and null for
 * "All terms" (no filter). `termId` stays the single-term id (null for
 * all/upcoming) so the many existing single-term callers keep working unchanged.
 *
 * Always returns the full term list (newest first) for the dropdown options,
 * with the current term flagged `isCurrent` — TermFilter hoists it for display
 * while callers that index the list (education.compliance's "newest" fallback)
 * keep seeing sortKey order.
 */
export async function resolveTermFilter(
  request: Request,
  opts?: { default?: "current" | "upcoming" },
): Promise<{
  terms: TermOption[];
  selected: string; // the value the dropdown shows: a term id, ALL_TERMS or UPCOMING
  termId: string | null; // the single selected term; null for all/upcoming
  termIds: string[] | null; // id set for a where{in}; null = no filter ("All terms")
  isAll: boolean;
  isUpcoming: boolean;
}> {
  const url = new URL(request.url);
  const param = url.searchParams.get("term");

  const [allTerms, current] = await Promise.all([
    prisma.term.findMany({
      orderBy: { sortKey: "desc" },
      select: { id: true, code: true, sortKey: true },
    }),
    currentTerm(),
  ]);
  const terms: TermOption[] = allTerms.map((t) => ({
    id: t.id,
    code: t.code,
    isCurrent: t.id === current?.id,
  }));

  // The current term plus every future term (sortKey ≥ current). Falls back to
  // the newest term if there's no current term but rows exist, so the page
  // isn't empty on a stale/empty-cycle DB.
  const upcomingIds = (): string[] => {
    const cur = allTerms.find((t) => t.id === current?.id);
    if (!cur) return allTerms[0] ? [allTerms[0].id] : [];
    return allTerms.filter((t) => t.sortKey >= cur.sortKey).map((t) => t.id);
  };
  const upcoming = () => {
    const ids = upcomingIds();
    return {
      terms,
      selected: UPCOMING,
      termId: null,
      termIds: ids.length ? ids : null,
      isAll: false,
      isUpcoming: true,
    };
  };

  if (param === ALL_TERMS) {
    return { terms, selected: ALL_TERMS, termId: null, termIds: null, isAll: true, isUpcoming: false };
  }
  if (param === UPCOMING) {
    return upcoming();
  }

  // An explicit, still-existing term id wins.
  if (param && terms.some((t) => t.id === param)) {
    return { terms, selected: param, termId: param, termIds: [param], isAll: false, isUpcoming: false };
  }

  // No/invalid param → the caller's default scope.
  if (opts?.default === "upcoming") {
    return upcoming();
  }
  const defaultId = current?.id ?? terms[0]?.id ?? null;
  return {
    terms,
    selected: defaultId ?? ALL_TERMS,
    termId: defaultId,
    termIds: defaultId ? [defaultId] : null,
    isAll: false,
    isUpcoming: false,
  };
}
