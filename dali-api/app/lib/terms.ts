import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";

// Re-exported for existing server-side importers. The definitions live in
// terms.shared so client components (TermFilter) can import them without
// pulling Prisma into the browser bundle.
export { ALL_TERMS, type TermOption } from "~/lib/terms.shared";
import { ALL_TERMS, type TermOption } from "~/lib/terms.shared";

/**
 * Resolves the term-filter state for a loader from the `?term=` search param,
 * shared by every page with a TermFilter dropdown.
 *
 * - No param  → default to the current term (per currentTerm()).
 * - `?term=all` → the "All terms" view (termId is null, isAll true).
 * - `?term=<id>` → that term, if it exists; otherwise falls back to current.
 *
 * Always returns the full term list (newest first) for the dropdown options.
 */
export async function resolveTermFilter(request: Request): Promise<{
  terms: TermOption[];
  selected: string; // the value the dropdown should show: a term id or ALL_TERMS
  termId: string | null; // null when "All terms" (or no terms exist)
  isAll: boolean;
}> {
  const url = new URL(request.url);
  const param = url.searchParams.get("term");

  const [terms, current] = await Promise.all([
    prisma.term.findMany({
      orderBy: { sortKey: "desc" },
      select: { id: true, code: true },
    }),
    currentTerm(),
  ]);

  if (param === ALL_TERMS) {
    return { terms, selected: ALL_TERMS, termId: null, isAll: true };
  }

  // An explicit, still-existing term id wins.
  if (param && terms.some((t) => t.id === param)) {
    return { terms, selected: param, termId: param, isAll: false };
  }

  // Default: current term (fall back to newest if currentTerm() is null but
  // terms exist, so the page isn't empty on a stale/empty-cycle DB).
  const defaultId = current?.id ?? terms[0]?.id ?? null;
  return {
    terms,
    selected: defaultId ?? ALL_TERMS,
    termId: defaultId,
    isAll: false,
  };
}
