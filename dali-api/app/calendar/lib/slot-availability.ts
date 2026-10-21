export type SlotStatus = "available" | "busy" | "outsideHours";

type IntervalLike = { startIso: string; endIso: string } | { start: Date; end: Date };

function toMs(iv: IntervalLike) {
  return "startIso" in iv
    ? { s: new Date(iv.startIso).getTime(), e: new Date(iv.endIso).getTime() }
    : { s: iv.start.getTime(), e: iv.end.getTime() };
}

export function coversSlot(intervals: IntervalLike[], startMs: number, endMs: number) {
  const sorted = intervals.map(toMs).sort((a, b) => a.s - b.s);
  let cursor = startMs;
  for (const iv of sorted) {
    if (iv.e <= cursor) continue;
    if (iv.s > cursor) break;
    cursor = iv.e;
    if (cursor >= endMs) break;
  }
  return cursor >= endMs;
}

// Outside-hours wins over busy when both apply: the person's own working hours
// are what rules the slot out, and that's what the organizer needs to ask about.
export function slotStatus(
  user: { free: IntervalLike[]; working: IntervalLike[] },
  startMs: number,
  endMs: number,
): SlotStatus {
  if (coversSlot(user.free, startMs, endMs)) return "available";
  if (!coversSlot(user.working, startMs, endMs)) return "outsideHours";
  return "busy";
}
