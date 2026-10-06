// Shared session-timing helpers: whether a session has actually happened yet,
// and attendance ratios computed against sessions *held* rather than every
// session scheduled on the offering. A course in progress should read
// "Attended 2 of 3 so far", not "Attended 2 of 10" — the other 7 haven't
// happened. Certificate eligibility stays on the full denominator elsewhere
// (certificates.server.ts) and does not use summarizeAttendance.

export type SessionTime = { datetime: string | Date; endsAt?: string | Date | null };

export function sessionEnd(s: SessionTime): Date {
  return new Date(s.endsAt ?? s.datetime);
}

export function isSessionPast(s: SessionTime, now: Date = new Date()): boolean {
  return sessionEnd(s) < now;
}

export function isSessionUpcoming(s: SessionTime, now: Date = new Date()): boolean {
  return sessionEnd(s) >= now;
}

export type AttendanceSummary = { present: number; excused: number; held: number; total: number };

export type SessionMark = { sessionId: string; status: string };

/**
 * present/excused are counted only against sessions already held — a Present
 * mark on a future session (e.g. a pre-filled roster) doesn't count.
 */
export function summarizeAttendance(
  sessions: (SessionTime & { id: string })[],
  marks: Iterable<SessionMark>,
  now: Date = new Date(),
): AttendanceSummary {
  const heldIds = new Set(sessions.filter((s) => isSessionPast(s, now)).map((s) => s.id));
  let present = 0;
  let excused = 0;
  for (const m of marks) {
    if (!heldIds.has(m.sessionId)) continue;
    if (m.status === "Present") present += 1;
    else if (m.status === "Excused") excused += 1;
  }
  return { present, excused, held: heldIds.size, total: sessions.length };
}

export function attendanceCopy(a: AttendanceSummary, style: "sentence" | "ratio"): string {
  if (a.held === 0) return "No sessions held yet";
  const soFar = a.held < a.total;
  const noun = a.held === 1 ? "session" : "sessions";
  if (style === "sentence") {
    const excusedSuffix = a.excused > 0 ? ` (+${a.excused} excused)` : "";
    return `Attended ${a.present}${excusedSuffix} of ${a.held} ${noun}${soFar ? " so far" : ""}`;
  }
  return `${a.present}/${a.held} ${noun}${soFar ? " so far" : ""}`;
}
