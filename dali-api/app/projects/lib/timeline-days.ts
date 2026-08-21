// Pure UTC-day math for the epics timeline.
//
// Epic/sprint dates are stored as UTC-midnight instants (date-only inputs
// serialized via toISOString), and the timeline's printed labels use the UTC
// calendar date. Bar geometry must therefore bucket instants into UTC days
// too — a local startOfDay() shifts bars a day early for viewers west of
// UTC while the labels stay put.

export const DAY = 86_400_000;

/** UTC midnight (ms) of the UTC calendar day containing the instant. */
export function utcDayStart(t: number): number {
  return Math.floor(t / DAY) * DAY;
}

/** UTC midnight (ms) of the ISO instant's UTC calendar day. */
export function utcDayOf(iso: string): number {
  return utcDayStart(Date.parse(iso));
}

/**
 * The viewer's local calendar date, keyed as a UTC midnight — this is the
 * day column the "today" marker should sit on. (Plain utcDayStart(now)
 * would mark tomorrow's column for US evenings.)
 */
export function localTodayUtcDay(now: Date = new Date()): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Day-column offset of `iso` from a UTC-midnight range start. */
export function dayOffset(iso: string, rangeStartUtc: number): number {
  return (utcDayOf(iso) - rangeStartUtc) / DAY;
}

/** Inclusive width in days of the [startIso, endIso] span. */
export function daySpan(startIso: string, endIso: string): number {
  return (utcDayOf(endIso) - utcDayOf(startIso)) / DAY + 1;
}

/** A term's span as the timeline receives it (ISO instants). */
export type TimelineTermSpan = { code: string; startsAt: string; endsAt: string };

/** One fixed-length sprint band on the timeline's header grid. */
export type SprintBand = {
  /** UTC-midnight ms of the band's first day — stable React key. */
  key: number;
  /** Inclusive UTC-midnight ms of the band's last day. */
  end: number;
  label: string;
};

/** Sprints are a fixed one-week grid rather than per-row date ranges. */
export const SPRINT_DAYS = 7;

/**
 * Tile [min, max] with fixed one-week sprint bands.
 *
 * The grid is anchored to the earliest term start (not to `min`) so band edges
 * line up with the academic calendar rather than with whatever date the first
 * epic happens to begin on, then stepped backwards to cover the whole range.
 * Bands are labelled with the term their first day falls in plus a letter
 * (26FA, 26FB, …); weeks outside every term get a week-of label.
 *
 * `terms` must be oldest-first. `min`/`max` are UTC-midnight ms.
 */
export function sprintBands(
  min: number,
  max: number,
  terms: TimelineTermSpan[],
  fmtDay: (d: Date) => string,
): SprintBand[] {
  const spans = terms.map((t) => ({
    code: t.code,
    start: utcDayOf(t.startsAt),
    end: utcDayOf(t.endsAt),
  }));
  const stepMs = SPRINT_DAYS * DAY;
  const anchor = spans.length ? spans[0]!.start : min;
  // Step back to the first band at or before `min`. Math.ceil on a positive
  // gap lands on or before min; a negative gap (anchor already before min)
  // clamps to zero steps.
  const backSteps = Math.max(Math.ceil((anchor - min) / stepMs), 0);

  const out: SprintBand[] = [];
  const seenInTerm = new Map<string, number>();
  for (let t = anchor - backSteps * stepMs; t <= max; t += stepMs) {
    const term = spans.find((s) => t >= s.start && t <= s.end);
    let label: string;
    if (term) {
      const idx = seenInTerm.get(term.code) ?? 0;
      seenInTerm.set(term.code, idx + 1);
      // Past 26 weeks in one term the letters would wrap; number those.
      label =
        idx < 26
          ? `Sprint ${term.code}${String.fromCharCode(65 + idx)}`
          : `Sprint ${term.code}·${idx + 1}`;
    } else {
      label = `Wk of ${fmtDay(new Date(t))}`;
    }
    out.push({ key: t, end: Math.min(t + stepMs - DAY, max), label });
  }
  return out;
}

/**
 * The fixed one-week bands a [startIso, endIso] span sits in.
 *
 * A record doesn't pick a sprint — a sprint is a week, so which ones a record
 * is in falls out of its dates. Labels are positional (a band's letter counts
 * weeks from the start of its term), so the grid has to be walked from the
 * terms' own beginning and then narrowed to the span; tiling only the span
 * would relabel its first week as that term's "A".
 */
export function sprintBandsForSpan(
  startIso: string,
  endIso: string,
  terms: TimelineTermSpan[],
  fmtDay: (d: Date) => string,
): SprintBand[] {
  const from = utcDayOf(startIso);
  const to = utcDayOf(endIso);
  if (to < from) return [];
  const starts = terms.map((t) => utcDayOf(t.startsAt));
  const min = starts.length ? Math.min(from, ...starts) : from;
  return sprintBands(min, to, terms, fmtDay).filter((b) => b.end >= from);
}
