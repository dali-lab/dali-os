import type { PerUserFree } from "~/calendar/lib/types";

export type SlotStatus = "available" | "busy" | "outsideHours";

function covers(intervals: { startIso: string; endIso: string }[], startMs: number, endMs: number) {
  const sorted = intervals
    .map((iv) => ({ s: new Date(iv.startIso).getTime(), e: new Date(iv.endIso).getTime() }))
    .sort((a, b) => a.s - b.s);
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
export function slotStatus(user: Pick<PerUserFree, "free" | "working">, startMs: number, endMs: number): SlotStatus {
  if (covers(user.free, startMs, endMs)) return "available";
  if (!covers(user.working, startMs, endMs)) return "outsideHours";
  return "busy";
}
