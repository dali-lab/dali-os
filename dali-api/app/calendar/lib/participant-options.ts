import { useEffect, useState } from "react";
import type { ParticipantOptions } from "~/calendar/lib/types";

export const EMPTY_PARTICIPANTS: ParticipantOptions = { groups: [], users: [], mentorPairs: [] };

// Reused for this long, so moving between weeks or reopening the create form
// doesn't re-read the whole directory, while a group created in another tab
// still shows up within a few minutes.
export const PARTICIPANTS_MAX_AGE_MS = 5 * 60_000;

let cached: { at: number; promise: Promise<ParticipantOptions> } | null = null;

export function fetchParticipantOptions(): Promise<ParticipantOptions> {
  if (cached && Date.now() - cached.at < PARTICIPANTS_MAX_AGE_MS) return cached.promise;
  const promise = fetch("/api/calendar/participants", { credentials: "include" }).then((res) => {
    if (!res.ok) throw new Error(`participants: ${res.status}`);
    return res.json() as Promise<ParticipantOptions>;
  });
  const entry = { at: Date.now(), promise };
  cached = entry;
  promise.catch(() => {
    if (cached === entry) cached = null;
  });
  return promise;
}

export function resetParticipantOptionsForTests(): void {
  cached = null;
}

/**
 * The lab directory, fetched after mount and again (if stale) whenever
 * `refreshKey` changes. Empty until it arrives, or when `enabled` is false.
 */
export function useParticipantOptions(enabled: boolean, refreshKey?: unknown): ParticipantOptions {
  const [options, setOptions] = useState<ParticipantOptions>(EMPTY_PARTICIPANTS);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchParticipantOptions().then(
      (next) => live && setOptions(next),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [enabled, refreshKey]);
  return options;
}
