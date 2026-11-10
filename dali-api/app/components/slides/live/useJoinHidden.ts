import { useCallback, useEffect, useRef, useState } from "react";

export const joinKey = (pageId: string) => `dali-slides-join:${pageId}`;

function readStored(pageId: string, presentationId: string | null): boolean {
  if (!presentationId) return false;
  try {
    return window.localStorage.getItem(joinKey(pageId)) === presentationId;
  } catch {
    return false;
  }
}

interface Message {
  id: string | null;
  hidden: boolean;
}

/** Whether the join code is hidden for one presentation, shared by the presenter's windows through a BroadcastChannel and localStorage. A new presentation starts shown. Falls back to this window alone if both fail. */
export function useJoinHidden(pageId: string, presentationId: string | null): [boolean, (hidden: boolean) => void] {
  const [hidden, setHidden] = useState(() => (typeof window === "undefined" ? false : readStored(pageId, presentationId)));
  const channel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    setHidden(readStored(pageId, presentationId));
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(joinKey(pageId));
      bc.onmessage = (e: MessageEvent<Message>) => {
        if (e.data && e.data.id === presentationId) setHidden(e.data.hidden === true);
      };
    } catch {
      bc = null;
    }
    channel.current = bc;
    const onStorage = (e: StorageEvent) => {
      if (e.key === joinKey(pageId)) setHidden(presentationId !== null && e.newValue === presentationId);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      bc?.close();
      channel.current = null;
    };
  }, [pageId, presentationId]);

  const set = useCallback(
    (next: boolean) => {
      setHidden(next);
      if (!presentationId) return;
      try {
        window.localStorage.setItem(joinKey(pageId), next ? presentationId : "0");
      } catch {}
      try {
        channel.current?.postMessage({ id: presentationId, hidden: next } satisfies Message);
      } catch {}
    },
    [pageId, presentationId],
  );
  return [hidden, set];
}
