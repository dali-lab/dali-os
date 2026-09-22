// Find the best meeting times for a set of participants from their free/busy.
//
// This is the single-meeting counterpart to the MCP `optimize_group_meetings`
// tool (~/lib/meeting-optimizer): that one jointly places SEVERAL meetings so
// people on more than one group aren't double-booked; here there's just one
// meeting (the scheduling grid), so all we need is to rank candidate slots by
// how many participants are free and surface the best distinct options.
//
// It runs client-side on purpose. The scheduling grid already fetches every
// participant's free intervals (/api/calendar/group-availability), so ranking
// needs no extra round-trip and stays perfectly consistent with the grid's
// gradient and the selected-slot "X/N free" badge — same "a known participant's
// free time covers the whole slot" test (see slotIsFree). Only participants
// with a real busy source are passed in; unknown-availability members are
// excluded upstream, exactly as the grid excludes them, so they never inflate a
// slot's count. Pure and framework-free so it can be unit-tested in isolation.

export type MsInterval = { startMs: number; endMs: number };

export type RankedSlot = {
  startMs: number;
  endMs: number;
  /** Known participants free for the whole slot. */
  freeCount: number;
};

/**
 * True iff the union of `free` (sorted ascending by start) covers the whole
 * [startMs, endMs) window. Mirrors the grid's selected-slot coverage walk so a
 * suggested slot's count matches what the user sees once it's applied: advance
 * a cursor through the intervals, bailing the moment a gap opens before the
 * cursor reaches the slot end.
 */
export function slotIsFree(free: MsInterval[], startMs: number, endMs: number): boolean {
  let cursor = startMs;
  for (const iv of free) {
    if (iv.endMs <= cursor) continue;
    if (iv.startMs > cursor) break; // a gap opens before coverage is continuous
    cursor = Math.max(cursor, iv.endMs);
    if (cursor >= endMs) break;
  }
  return cursor >= endMs;
}

/**
 * Business-hours grid of candidate meeting slots across the given local days.
 * `dayStartMs[i]` is local midnight (epoch ms) of grid day i; starts step every
 * `stepMinutes` within [bandStartHour, bandEndHour) and a meeting must end
 * within the band. The band keeps "optimal" to sensible daytime/evening hours —
 * without it a 3am slot where everyone's calendar is empty would rank as
 * "everyone free".
 */
export function candidateSlots(
  dayStartMs: number[],
  bandStartHour: number,
  bandEndHour: number,
  stepMinutes: number,
  durationMinutes: number,
): MsInterval[] {
  const out: MsInterval[] = [];
  const durMs = durationMinutes * 60_000;
  const firstStartMin = bandStartHour * 60;
  const lastStartMin = bandEndHour * 60 - durationMinutes; // must end by band end
  for (const dayMs of dayStartMs) {
    for (let min = firstStartMin; min <= lastStartMin; min += stepMinutes) {
      const startMs = dayMs + min * 60_000;
      out.push({ startMs, endMs: startMs + durMs });
    }
  }
  return out;
}

/**
 * Rank candidate slots by how many known participants are free for the whole
 * slot (desc), earliest first on ties, then greedily keep only slots that don't
 * overlap an already-kept one — so the suggestions are distinct times spread
 * across the week rather than five variants of the same morning. Slots nobody is
 * free for are dropped.
 */
export function rankSlots(
  candidates: MsInterval[],
  perUserFree: MsInterval[][],
  maxResults: number,
): RankedSlot[] {
  const scored: RankedSlot[] = [];
  for (const c of candidates) {
    let freeCount = 0;
    for (const free of perUserFree) {
      if (slotIsFree(free, c.startMs, c.endMs)) freeCount++;
    }
    if (freeCount > 0) scored.push({ startMs: c.startMs, endMs: c.endMs, freeCount });
  }
  scored.sort((a, b) => b.freeCount - a.freeCount || a.startMs - b.startMs);

  const kept: RankedSlot[] = [];
  for (const s of scored) {
    if (kept.length >= maxResults) break;
    if (kept.some((k) => s.startMs < k.endMs && k.startMs < s.endMs)) continue; // overlaps a kept slot
    kept.push(s);
  }
  return kept;
}

/** Build candidate slots over the days/band and return the best distinct ones. */
export function findOptimalSlots(opts: {
  dayStartMs: number[];
  perUserFree: MsInterval[][];
  bandStartHour: number;
  bandEndHour: number;
  stepMinutes: number;
  durationMinutes: number;
  maxResults: number;
}): RankedSlot[] {
  const candidates = candidateSlots(
    opts.dayStartMs,
    opts.bandStartHour,
    opts.bandEndHour,
    opts.stepMinutes,
    opts.durationMinutes,
  );
  return rankSlots(candidates, opts.perUserFree, opts.maxResults);
}
