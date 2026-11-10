import { useCallback, useEffect, useRef, useState } from "react";
import { useEventStream } from "~/hooks/useEventStream";
import { INACTIVE_LIVE, liveStreamUrl, liveUrl, type LiveState } from "./types";

export function useLiveState(pageId: string | null) {
  const [live, setLiveState] = useState<LiveState>(INACTIVE_LIVE);
  const [ready, setReady] = useState(false);
  const seq = useRef(0);

  const setLive = useCallback((next: LiveState | ((prev: LiveState) => LiveState)) => {
    seq.current += 1;
    setLiveState(next);
  }, []);

  const refetch = useCallback(async () => {
    if (!pageId) return;
    const mine = ++seq.current;
    try {
      const res = await fetch(liveUrl(pageId), { credentials: "same-origin" });
      if (!res.ok || mine !== seq.current) return;
      setLiveState((await res.json()) as LiveState);
      setReady(true);
    } catch {
      // The next stream event or sync retries.
    }
  }, [pageId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useEventStream(pageId ? [liveStreamUrl(pageId)] : [], refetch);

  return { live, setLive, refetch, ready };
}
