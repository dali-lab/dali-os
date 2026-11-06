import { useCallback, useEffect, useRef, useState } from "react";

export const joinKey = (pageId: string) => `dali-slides-join:${pageId}`;

function readStored(pageId: string): boolean {
  try {
    return window.localStorage.getItem(joinKey(pageId)) === "1";
  } catch {
    return false;
  }
}

/** Whether the join code is hidden, shared by the presenter's windows through a BroadcastChannel and localStorage. Falls back to this window alone if both fail. */
export function useJoinHidden(pageId: string): [boolean, (hidden: boolean) => void] {
  const [hidden, setHidden] = useState(() => (typeof window === "undefined" ? false : readStored(pageId)));
  const channel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    setHidden(readStored(pageId));
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(joinKey(pageId));
      bc.onmessage = (e: MessageEvent) => setHidden(e.data === true);
    } catch {
      bc = null;
    }
    channel.current = bc;
    const onStorage = (e: StorageEvent) => {
      if (e.key === joinKey(pageId)) setHidden(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      bc?.close();
      channel.current = null;
    };
  }, [pageId]);

  const set = useCallback(
    (next: boolean) => {
      setHidden(next);
      try {
        window.localStorage.setItem(joinKey(pageId), next ? "1" : "0");
      } catch {}
      try {
        channel.current?.postMessage(next);
      } catch {}
    },
    [pageId],
  );
  return [hidden, set];
}
