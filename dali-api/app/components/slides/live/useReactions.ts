import { useCallback, useEffect, useRef, useState } from "react";
import { REACTION_LIFETIME_MS, reactionsStreamUrl, reactionsUrl } from "./polls";

export interface FloatingReaction {
  id: string;
  emoji: string;
  left: number;
}

export function parseReaction(raw: string): { id: string; emoji: string } | null {
  try {
    const data = JSON.parse(raw) as { id?: unknown; emoji?: unknown };
    return typeof data.id === "string" && typeof data.emoji === "string" ? { id: data.id, emoji: data.emoji } : null;
  } catch {
    return null;
  }
}

/** Reactions arriving on the stream, each kept for as long as it takes to float up. */
export function useReactions(pageId: string, enabled: boolean): FloatingReaction[] {
  const [items, setItems] = useState<FloatingReaction[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const es = new EventSource(reactionsStreamUrl(pageId), { withCredentials: true });
    es.addEventListener("change", (e) => {
      const reaction = parseReaction((e as MessageEvent<string>).data);
      if (!reaction) return;
      const item = { ...reaction, left: 8 + Math.random() * 84 };
      setItems((prev) => [...prev.slice(-30), item]);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setItems((prev) => prev.filter((r) => r.id !== item.id));
      }, REACTION_LIFETIME_MS);
      timers.current.add(timer);
    });
    const pending = timers.current;
    return () => {
      es.close();
      for (const t of pending) clearTimeout(t);
      pending.clear();
    };
  }, [pageId, enabled]);

  return items;
}

export function useSendReaction(pageId: string) {
  return useCallback(
    async (emoji: string): Promise<boolean> => {
      try {
        const res = await fetch(reactionsUrl(pageId), {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji }),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    [pageId],
  );
}
