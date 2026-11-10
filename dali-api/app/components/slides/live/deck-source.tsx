import { useEffect, useState, type ReactNode } from "react";
import type { RenderSlide } from "~/components/slides/deck/snapshot";

export interface PresentDeck {
  themeId: string;
  slides: RenderSlide[];
  notes: Record<string, string>;
}

export interface DeckSourceProps {
  pageId: string;
  /** A collab token connects to the room so the deck stays current; without one the loader's copy is used. */
  token: string | null;
  fallback: PresentDeck;
  children: (deck: PresentDeck) => ReactNode;
}

/** Draws from the loader's copy at once, then from the live room once it has connected. The collab client loads after hydration. */
export function DeckSource({ pageId, token, fallback, children }: DeckSourceProps) {
  const [live, setLive] = useState<PresentDeck | null>(null);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let disconnect: (() => void) | null = null;
    void import("./connect-deck").then((m) => {
      if (!cancelled) disconnect = m.connectDeck(pageId, token, setLive);
    });
    return () => {
      cancelled = true;
      disconnect?.();
      setLive(null);
    };
  }, [pageId, token]);
  return <>{children(live ?? fallback)}</>;
}
