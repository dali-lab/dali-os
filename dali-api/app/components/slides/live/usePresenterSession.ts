import { useCallback, useEffect, useRef } from "react";
import { liveChannelName, liveUrl, type LiveState } from "./types";
import { useLiveState } from "./useLiveState";

async function post(pageId: string, body: Record<string, unknown>): Promise<LiveState | null> {
  try {
    const res = await fetch(liveUrl(pageId), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok ? ((await res.json()) as LiveState) : null;
  } catch {
    return null;
  }
}

export function usePresenterSession(pageId: string) {
  const { live, setLive, refetch, ready } = useLiveState(pageId);
  const channel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(liveChannelName(pageId));
    ch.onmessage = (e: MessageEvent<{ slideId?: string; build?: number }>) => {
      const { slideId, build } = e.data ?? {};
      if (typeof slideId !== "string") return;
      setLive((prev) => (prev.active ? { ...prev, slideId, build: build ?? 0 } : prev));
    };
    channel.current = ch;
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [pageId, setLive]);

  const commit = useCallback(
    async (body: Record<string, unknown>) => {
      const next = await post(pageId, body);
      if (next) setLive(next);
      else await refetch();
    },
    [pageId, setLive, refetch],
  );

  const start = useCallback((slideId: string, build = 0) => commit({ intent: "start", slideId, build }), [commit]);

  const go = useCallback(
    (slideId: string, build = 0) => {
      setLive((prev) => (prev.active ? { ...prev, slideId, build } : prev));
      channel.current?.postMessage({ slideId, build });
      return commit({ intent: "go", slideId, build });
    },
    [commit, setLive],
  );

  const end = useCallback(() => {
    setLive((prev) => ({ ...prev, active: false }));
    return commit({ intent: "end" });
  }, [commit, setLive]);

  return { live, ready, start, go, end, refetch };
}
