import { useEffect, useState } from "react";

export type CurrentMember = {
  id: string;
  daliEmail: string;
  firstName?: string | null;
  lastName?: string | null;
};

export const CURRENT_MEMBERS_MAX_AGE_MS = 5 * 60_000;

const EMPTY: CurrentMember[] = [];

let cached: { at: number; promise: Promise<CurrentMember[]> } | null = null;
let lastKnown: CurrentMember[] = EMPTY;

export function fetchCurrentMembers(): Promise<CurrentMember[]> {
  if (cached && Date.now() - cached.at < CURRENT_MEMBERS_MAX_AGE_MS) return cached.promise;
  const promise = fetch("/api/members?scope=current", { credentials: "include" }).then(async (res) => {
    if (!res.ok) throw new Error(`members: ${res.status}`);
    const list = (await res.json()) as CurrentMember[];
    lastKnown = list;
    return list;
  });
  const entry = { at: Date.now(), promise };
  cached = entry;
  promise.catch(() => {
    if (cached === entry) cached = null;
  });
  return promise;
}

export function resetCurrentMembersForTests(): void {
  cached = null;
  lastKnown = EMPTY;
}

/**
 * Current-term lab roster for reviewer, interviewer and roster pickers. A
 * remount shows the last roster instantly and refreshes it if it has gone
 * stale. Alumni are excluded, so a picker can't offer someone who has left.
 */
export function useCurrentMembers(enabled = true): CurrentMember[] {
  const [members, setMembers] = useState(lastKnown);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchCurrentMembers().then(
      (next) => live && setMembers(next),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [enabled]);
  return members;
}
