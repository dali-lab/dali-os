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

export type CancelOutcome = { ok: true } | { ok: false; error: string };

const CANCEL_FAILED = "Couldn't cancel the booking.";

/** Asks the server to cancel. A network failure comes back as a failed outcome
 *  like any rejection, so the caller can always put the booking back. */
export async function requestCancel(
  bookingId: string,
  body?: { scope: CancelScope; occurrenceStart: string },
): Promise<CancelOutcome> {
  try {
    const res = await fetch(`/api/room-bookings/${bookingId}/cancel`, {
      method: "POST",
      credentials: "include",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    if (res.ok) return { ok: true };
    const json = await res.json().catch(() => ({}));
    return { ok: false, error: typeof json?.error === "string" && json.error ? json.error : CANCEL_FAILED };
  } catch {
    return { ok: false, error: CANCEL_FAILED };
  }
}
