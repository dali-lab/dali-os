import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useSidePanel } from "~/components/side-panel/use-side-panel";
import { isAskShortcut } from "~/lib/shortcuts";
import { ASK_PANEL } from "~/lib/side-panel";
import { sharedAskThread, type AskThread, type AskThreadState } from "../thread";

export function useAskThread(thread: AskThread = sharedAskThread()): AskThreadState {
  return useSyncExternalStore(thread.subscribe, thread.getState, thread.getState);
}

/** Opens the Ask panel, optionally asking a question as it opens; toggles it closed when it's already open and nothing is asked. */
export function useOpenAsk() {
  const { panel, open, close } = useSidePanel();
  const isOpen = panel?.type === "ask";
  const openAsk = useCallback(
    (question?: string) => {
      if (question?.trim()) void sharedAskThread().ask(question);
      open(ASK_PANEL);
    },
    [open],
  );
  const toggle = useCallback(() => (isOpen ? close() : open(ASK_PANEL)), [isOpen, close, open]);
  return { isOpen, openAsk, toggle };
}

export function useAskShortcut(enabled: boolean, toggle: () => void) {
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isAskShortcut(e)) return;
      e.preventDefault();
      toggleRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
