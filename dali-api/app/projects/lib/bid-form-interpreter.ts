// Turn a bound form's answers into ranked project bids, using the binding's
// saved column mapping (slot-roles.ts). A bid is now just a project — domain
// is expanded server-side in validateBids() from the member's
// DomainEligibility set (one StaffingPreference per project × eligibility).
// Free-form text lives on submission-scoped display columns, not on the bid.
//
// Ranking = the `order` of the `project` entries (1st mapped project column
// is rank 1, etc.). A column whose answer is blank is a skipped choice; it
// is NOT an error, because the raw submission is still recorded by the
// caller regardless.
//
// Pure (no DB/HTTP) so it is exhaustively unit-testable.

import type { RawBid } from "./bid-validation";
import type { ColumnMapping, ColumnMappingEntry } from "./slot-roles";

function asId(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

export type InterpretResult =
  | { ok: true; bids: RawBid[] }
  | { ok: false; error: string };

// Entries for one role, in the manager's column order. `order` is always set
// by parseColumnMapping (legacy entries get their array index), so this is a
// stable rank.
function entriesForRole(
  mapping: ColumnMapping,
  role: string,
): ColumnMappingEntry[] {
  return mapping.entries
    .filter((e) => e.role === role && e.source === "question")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function interpretBidForm(
  answers: Record<string, unknown>,
  mapping: ColumnMapping,
): InterpretResult {
  const projects = entriesForRole(mapping, "project");

  const bids: RawBid[] = [];
  for (const pEntry of projects) {
    if (pEntry.source !== "question") continue;
    const projectId = asId(answers[pEntry.questionKey]);
    // Blank ranked choice → the member skipped this pick; drop it but keep
    // the rest of their bids (and the raw submission) flowing.
    if (projectId == null) continue;
    bids.push({ projectId });
  }

  // No completed bids isn't an interpreter error — the submission is still
  // recorded by the caller; it just produces no StaffingPreference rows.
  return { ok: true, bids };
}
