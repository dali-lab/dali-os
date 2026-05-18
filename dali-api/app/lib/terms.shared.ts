// Client-safe term-filter vocabulary. Kept separate from ~/lib/terms (which
// imports Prisma via resolveTermFilter) so client components like TermFilter
// can use the sentinel/type without dragging the Prisma client — and its
// node:url dependency — into the browser bundle.

// Sentinel used by the term-filter dropdown for the "All terms" choice. Kept
// here so loaders and the TermFilter component agree on the wire value.
export const ALL_TERMS = "all" as const;

export type TermOption = { id: string; code: string };
