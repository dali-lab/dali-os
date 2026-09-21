// The Guide CTA's cross-frame bridge.
//
// The CTA belongs in the shell's top bar next to the bell, in both shells. In
// tabless mode the shell shares a document with the routed page, so it reads
// the route's docKey itself. In tab mode the page lives in a TabWorkspace
// iframe and only that document knows the docKey — which is why the CTA used
// to render on a row inside the page there. So the frame announces its guide
// to the shell, the shell draws the button for whichever tab is focused, and
// the click travels back to that frame.

export const GUIDE_STATE_MESSAGE = "dali:pageGuide";
export const GUIDE_OPEN_MESSAGE = "dali:openPageGuide";

/** What the focused frame's guide looks like, as the shell needs to know it. */
export type GuideState = {
  /** The route declares a docKey, so there is a guide to open. */
  hasGuide: boolean;
  /** Already showing — the open guide draws its own Close, so the CTA stands down. */
  open: boolean;
};

/** Frame side: announce this document's guide to the shell. */
export function postGuideState(state: GuideState): void {
  if (typeof window === "undefined") return;
  if (window.self === window.top) return;
  window.parent.postMessage(
    { type: GUIDE_STATE_MESSAGE, ...state },
    window.location.origin,
  );
}

/** Shell side: read a guide announcement, or null for any other message. */
export function readGuideState(data: unknown): GuideState | null {
  const d = data as { type?: unknown; hasGuide?: unknown; open?: unknown } | null;
  if (!d || d.type !== GUIDE_STATE_MESSAGE) return null;
  return { hasGuide: Boolean(d.hasGuide), open: Boolean(d.open) };
}
