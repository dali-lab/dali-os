import type { TimesheetExport } from "./types";

// Thin, dependency-free client for the two DALI endpoints this extension needs.
// Pure functions (origin + token passed in) — the service worker owns storage
// and decides when to call these.

export interface PairSession {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

export interface PairPoll {
  status: "pending" | "slow_down" | "approved" | "denied" | "expired" | "already_used";
  desktopToken?: string;
  interval?: number;
}

/** Kick off DALI's device-approval flow. */
export async function startPairing(origin: string, deviceLabel: string): Promise<PairSession> {
  const res = await fetch(`${origin}/auth/pair/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceLabel }),
  });
  if (!res.ok) throw new Error(`pair/start failed (${res.status})`);
  return (await res.json()) as PairSession;
}

/** Ask once whether the user has approved yet. */
export async function pollPairing(origin: string, deviceCode: string): Promise<PairPoll> {
  const res = await fetch(`${origin}/auth/pair/poll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceCode }),
  });
  if (!res.ok) throw new Error(`pair/poll failed (${res.status})`);
  return (await res.json()) as PairPoll;
}

export class SessionExpired extends Error {}
export class NoEntries extends Error {}

/** Pull logged hours for a hire + window. Distinguishes expired-token and
 *  nothing-in-range so the panel can react (re-connect vs. widen the window). */
export async function fetchExport(
  origin: string,
  token: string,
  opts: { from?: string; to?: string; hire?: string },
): Promise<TimesheetExport> {
  const qs = new URLSearchParams();
  if (opts.from) qs.set("from", opts.from);
  if (opts.to) qs.set("to", opts.to);
  if (opts.hire) qs.set("hire", opts.hire);
  const suffix = qs.toString() ? `?${qs}` : "";

  const res = await fetch(`${origin}/api/timesheets/export${suffix}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new SessionExpired();
  if (res.status === 404) throw new NoEntries();
  if (!res.ok) throw new Error(`export failed (${res.status})`);
  return (await res.json()) as TimesheetExport;
}
