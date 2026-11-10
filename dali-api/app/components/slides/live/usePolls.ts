import { useCallback, useEffect, useRef, useState } from "react";
import { useEventStream } from "~/hooks/useEventStream";
import { NO_POLLS, pollsStreamUrl, pollsUrl, type PollsState } from "./polls";

async function send(pageId: string, body: Record<string, unknown>): Promise<PollsState | null> {
  try {
    const res = await fetch(pollsUrl(pageId), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok ? ((await res.json()) as PollsState) : null;
  } catch {
    return null;
  }
}

/** Poll results for the presentation on now, kept fresh by the poll stream. */
export function usePolls(pageId: string, enabled = true) {
  const [state, setState] = useState<PollsState>(NO_POLLS);
  const seq = useRef(0);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    const mine = ++seq.current;
    try {
      const res = await fetch(pollsUrl(pageId), { credentials: "same-origin" });
      if (!res.ok || mine !== seq.current) return;
      setState((await res.json()) as PollsState);
    } catch {
      // The next stream event or sync retries.
    }
  }, [pageId, enabled]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useEventStream(enabled ? [pollsStreamUrl(pageId)] : [], refetch);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      seq.current += 1;
      const next = await send(pageId, body);
      if (next) setState(next);
      else await refetch();
    },
    [pageId, refetch],
  );

  const vote = useCallback(
    (pollId: string, choices: number[]) => {
      setState((prev) => {
        const old = prev.polls[pollId];
        if (!old) return prev;
        const counts = old.counts.map((n, i) => n - (old.mine.includes(i) ? 1 : 0) + (choices.includes(i) ? 1 : 0));
        const total = old.total - (old.mine.length ? 1 : 0) + (choices.length ? 1 : 0);
        return { ...prev, polls: { ...prev.polls, [pollId]: { ...old, counts, total, mine: choices } } };
      });
      return act({ intent: "vote", pollId, choices });
    },
    [act],
  );

  return {
    state,
    vote,
    close: (pollId: string) => act({ intent: "close", pollId }),
    open: (pollId: string) => act({ intent: "open", pollId }),
    reset: (pollId: string) => act({ intent: "reset", pollId }),
    setReactionsOff: (off: boolean) => act({ intent: "reactions", off }),
  };
}
