// Client-safe waitlist rank helpers. A domain's waitlist is one order across
// every cycle, but each cycle's Final delibs numbers its own waitlisters from
// #1, so two cycles can hand the same domain two #1s. Those ties are surfaced
// on the Waitlists page until Core drags them into an explicit order.

/** Ranks held by more than one entry. */
export function tiedRanks(ranks: number[]): Set<number> {
  const seen = new Set<number>();
  const tied = new Set<number>();
  for (const r of ranks) {
    if (seen.has(r)) tied.add(r);
    seen.add(r);
  }
  return tied;
}

/**
 * Closes gaps without breaking ties: [2, 2, 4, 7] → [1, 1, 2, 3]. Used after
 * someone leaves the list, so the next person moves up but a tie that Core
 * hasn't resolved yet stays a tie rather than being settled arbitrarily.
 */
export function compactRanks(ranks: number[]): number[] {
  const distinct = [...new Set(ranks)].sort((a, b) => a - b);
  const next = new Map(distinct.map((r, i) => [r, i + 1]));
  return ranks.map((r) => next.get(r)!);
}
