import { createContext, createElement, useCallback, useContext, useMemo, useState, startTransition } from "react";
import type { ReactNode } from "react";
import type { PendingSubmission } from "~/calendar/lib/optimistic-layer";

type PendingStore = {
  pending: PendingSubmission[];
  /** Draw a write that goes out through plain `fetch()`. Returns the call that
   *  takes it off the grid again, once fresh data has landed or the write failed. */
  register: (sub: PendingSubmission) => () => void;
};

const NOOP_STORE: PendingStore = { pending: [], register: () => () => {} };

const PendingSubmissionsContext = createContext<PendingStore>(NOOP_STORE);

export function PendingSubmissionsProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingSubmission[]>([]);
  const register = useCallback((sub: PendingSubmission) => {
    setPending((prev) => [...prev, sub]);
    // A transition, like the router's own commits: an urgent release would
    // paint the grid a frame before the fresh loader data or fetcher state.
    return () => startTransition(() => setPending((prev) => prev.filter((p) => p !== sub)));
  }, []);
  const value = useMemo(() => ({ pending, register }), [pending, register]);
  return createElement(PendingSubmissionsContext.Provider, { value }, children);
}

/** Outside the calendar page (the interview scheduler) there is no grid to draw
 *  on, so registering is a no-op. */
export const usePendingSubmissions = () => useContext(PendingSubmissionsContext);

let nextId = 0;
export const newPendingId = (prefix: string) => `${prefix}:${++nextId}`;
