// Turn a bound form's answers into ranked project bids, using the binding's
// saved column mapping (slot-roles.ts) — NOT reference-source guessing. The
// form is fully flexible; a staffing manager explicitly maps which question
// is the Project / Domain / Notes column for each ranked choice.
//
// Ranking = the order of `project` entries in mapping.entries. Each project
// entry pairs with the `domain` entry and (optional) `notes` entry that
// follow it before the next project entry. Reference answers are real DB ids
// (projectId/domainId) — public-form.ts re-validates them against live
// options before storing, so a stored reference answer is a trustworthy id.
//
// `level` is NOT collected by the form; the caller resolves it from the
// member's DomainEligibility via validateBids(). Pure (no DB/HTTP) so it is
// exhaustively unit-testable.

import type { RawBid } from "./bid-validation";
import type { ColumnMapping } from "./slot-roles";

function asId(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

export type InterpretResult =
  | { ok: true; bids: RawBid[] }
  | { ok: false; error: string };

// Group mapping entries into ranked bids by the order of `project` entries,
// then read each group's answers. Mapping validity (required roles present,
// right question types, no stale keys) is the caller's responsibility via
// validateMapping(); this only assembles + checks completeness of answers.
export function interpretBidForm(
  answers: Record<string, unknown>,
  mapping: ColumnMapping,
): InterpretResult {
  const bids: RawBid[] = [];
  let cur:
    | { projectId: string | null; domainId: string | null; notes: string | null }
    | null = null;

  const flush = (): InterpretResult | null => {
    if (!cur) return null;
    // A group with neither side answered is a skipped (optional) choice —
    // drop it silently rather than erroring.
    if (cur.projectId == null && cur.domainId == null) {
      cur = null;
      return null;
    }
    if (cur.projectId == null || cur.domainId == null) {
      return {
        ok: false,
        error: "Incomplete bid: choose both a project and a domain.",
      };
    }
    bids.push({
      projectId: cur.projectId,
      domainId: cur.domainId,
      notes: cur.notes,
    });
    cur = null;
    return null;
  };

  for (const e of mapping.entries) {
    // Builtin columns (e.g. the submitter) carry no answer to interpret —
    // the submitter is keyed from the session in public-form.ts, not here.
    if (e.source === "builtin") continue;
    if (e.role === "project") {
      const flushed = flush();
      if (flushed) return flushed;
      cur = { projectId: asId(answers[e.questionKey]), domainId: null, notes: null };
      continue;
    }
    if (!cur) continue; // entries before the first project entry
    if (e.role === "domain") {
      if (cur.domainId == null) cur.domainId = asId(answers[e.questionKey]);
      continue;
    }
    if (e.role === "notes" && cur.notes == null) {
      const v = answers[e.questionKey];
      cur.notes = typeof v === "string" && v.trim() !== "" ? v.trim() : null;
    }
  }
  const tail = flush();
  if (tail) return tail;

  if (bids.length === 0) {
    return { ok: false, error: "No bids were submitted." };
  }
  return { ok: true, bids };
}
