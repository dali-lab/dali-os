import { useMemo, type ReactNode } from "react";
import { PollContext } from "~/components/slides/deck/content-render";
import type { PollsState } from "./polls";

/** Lets poll elements underneath show results, and take votes when `onVote` is given. */
export function PollLayer({ state, onVote, children }: { state: PollsState; onVote?: (pollId: string, choices: number[]) => void; children: ReactNode }) {
  const value = useMemo(() => ({ results: state.polls, onVote }), [state.polls, onVote]);
  return <PollContext.Provider value={value}>{children}</PollContext.Provider>;
}
