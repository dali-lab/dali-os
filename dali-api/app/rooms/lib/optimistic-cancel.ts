type Cancellable = { id: string; start: string; end: string; occurrenceStart: string };

export type CancelScope = "this" | "following" | "all";

/** The day's schedule with a cancel already applied: the cancelled times drop
 *  out, except that a booking underway is cut short at `now` rather than
 *  vanishing, because ending it keeps the time that already passed. */
export function withoutCancelled<T extends Cancellable>(
  items: T[],
  target: T,
  scope: CancelScope,
  now: Date,
): T[] {
  const from = Date.parse(target.start);
  const hit = (i: T) => {
    if (i.id !== target.id) return false;
    if (scope === "all") return true;
    if (scope === "following") return Date.parse(i.start) >= from;
    return i.occurrenceStart === target.occurrenceStart;
  };
  return items.flatMap((i) => {
    if (!hit(i)) return [i];
    if (Date.parse(i.start) <= now.getTime() && Date.parse(i.end) > now.getTime() && scope !== "all") {
      return [{ ...i, end: now.toISOString() }];
    }
    return [];
  });
}
