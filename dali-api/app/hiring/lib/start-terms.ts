// Start terms: the term a hire BEGINS in, as opposed to the term the hiring
// cycle runs in (ApplicationCycle.termId, which dates the phase weeks).
//
// A Students cycle offers a set of start terms (ApplicationCycle.startTermIds);
// the applicant picks one and it lands on Application.startTermId. Everything
// here is pure so the setup card, the applicant picker, and the server-side
// writers all agree without a DB round trip. DB resolution lives in
// start-terms.server.ts.
//
// The stored array is kept CANONICAL — chronological, de-duplicated, and
// floored (see rule 1) — by the one writer that produces it, so every reader
// can render it in array order and no surface has to re-sort. Lead click order
// is deliberately not preserved: a start-term list only ever reads forward in
// time, and MultiSelect shows its chips in option order anyway.
//
// Two rules the whole feature rests on:
//
//   1. A start term is never EARLIER than the term the hiring runs in. You
//      cannot be hired into a term that has already begun relative to your own
//      cycle, so the floor is the cycle's own term. Enforced on every write
//      (the lead's option set and the applicant's pick) and re-applied when a
//      lead moves the cycle's term.
//
//   2. An empty/unknown start term reads as the cycle's own term. That is what
//      makes this additive: every cycle and application that predates the
//      feature keeps the behavior it has today, where the two were the same
//      thing by assumption.

/** A Term as the start-term helpers need it. `sortKey` is the chronological key. */
export type StartTermOption = { id: string; code: string; sortKey: number };

/**
 * The terms a cycle whose hiring runs in `cycleTermSortKey` may offer as start
 * terms: that term and everything after it, oldest first so the picker reads
 * forward in time (the opposite of the term FILTER dropdowns, which lead with
 * the current term and go back through history).
 *
 * A cycle with no term of its own has no floor to apply, so every term is
 * eligible — the lead picks the term on the same card, and once they do the
 * set is pruned to it.
 */
export function eligibleStartTerms(
  terms: StartTermOption[],
  cycleTermSortKey: number | null,
): StartTermOption[] {
  return terms
    .filter((t) => cycleTermSortKey == null || t.sortKey >= cycleTermSortKey)
    .slice()
    .sort((a, b) => a.sortKey - b.sortKey);
}

/**
 * The cycle's saved start terms, hydrated, chronological. Ids with no matching
 * Term are dropped rather than rendered as a blank row — the column has no
 * foreign key, so a stale id is possible in principle. Sorting here as well as
 * in `pruneStartTermIds` keeps a row written before the array was canonical
 * (or edited by hand) reading in order.
 */
export function resolveStartTerms(
  terms: StartTermOption[],
  startTermIds: string[],
): StartTermOption[] {
  const byId = new Map(terms.map((t) => [t.id, t]));
  return startTermIds
    .map((id) => byId.get(id))
    .filter((t): t is StartTermOption => t !== undefined)
    .sort((a, b) => a.sortKey - b.sortKey);
}

/**
 * `startTermIds` reduced to canonical form: unknown ids, duplicates, and
 * anything before the floor removed, the rest chronological. The single writer
 * of the stored column. Run on save (so a stale client cannot post a term
 * before the cycle's own) and again when a lead moves the cycle's term later,
 * which can strip options that were valid when they were chosen.
 */
export function pruneStartTermIds(
  startTermIds: string[],
  terms: StartTermOption[],
  cycleTermSortKey: number | null,
): string[] {
  const requested = new Set(startTermIds);
  return eligibleStartTerms(terms, cycleTermSortKey)
    .filter((t) => requested.has(t.id))
    .map((t) => t.id);
}

/**
 * Whether the applicant sees a picker. One offered term is not a choice — the
 * start term is recorded for them and the application stays as it is today —
 * so the picker needs at least two.
 */
export function offersStartTermChoice(startTermIds: string[]): boolean {
  return startTermIds.length >= 2;
}

/**
 * The start term to record for an applicant with no pick of their own: the
 * single offered term when that is the only one, else none. Used at draft
 * creation so a cycle that offers exactly one start term still produces the
 * structured value the onboarding board filters on.
 */
export function impliedStartTermId(startTermIds: string[]): string | null {
  return startTermIds.length === 1 ? startTermIds[0]! : null;
}

/**
 * A posted `startTermIds` field (JSON-encoded string[], the same convention as
 * the forms editor's `questions` and the apply page's `selectedDomainIds`) as a
 * plain string array. Anything unparseable or not an array of strings reads as
 * empty — pruneStartTermIds validates the ids themselves, so this only has to
 * refuse to throw on a malformed body.
 */
export function parseStartTermIds(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v): v is string => typeof v === "string" && v !== "");
}

/**
 * Is `termId` one this cycle offers? The gate for the applicant's pick — the
 * offered set is already floored, so membership is the whole check.
 */
export function isOfferedStartTerm(
  startTermIds: string[],
  termId: string | null | undefined,
): boolean {
  return !!termId && startTermIds.includes(termId);
}
