import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveState } from "./useLiveState";

export function useFollowDeck(pageId: string) {
  const { live, ready } = useLiveState(pageId);
  const [optedOut, setOptedOut] = useState(false);
  const wasActive = useRef(false);

  useEffect(() => {
    if (live.active && !wasActive.current) setOptedOut(false);
    wasActive.current = live.active;
  }, [live.active]);

  const browseOnMyOwn = useCallback(() => setOptedOut(true), []);
  const follow = useCallback(() => setOptedOut(false), []);

  return {
    ready,
    active: live.active,
    slideId: live.slideId,
    build: live.build,
    presenter: live.presenter,
    startedAt: live.startedAt,
    reactionsOff: live.reactionsOff,
    following: live.active && !optedOut,
    browseOnMyOwn,
    follow,
  };
}
