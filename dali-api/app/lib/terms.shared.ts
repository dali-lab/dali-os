// Client-safe term-filter vocabulary. Kept separate from ~/lib/terms (which
// imports Prisma via resolveTermFilter) so client components like TermFilter
// can use the sentinel/type without dragging the Prisma client — and its
// node:url dependency — into the browser bundle.

// Sentinel used by the term-filter dropdown for the "All terms" choice. Kept
// here so loaders and the TermFilter component agree on the wire value.
export const ALL_TERMS = "all" as const;

export type TermOption = { id: string; code: string };

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
