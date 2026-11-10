import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findMatches, replaceMatches, type FindMatch } from "~/components/slides/deck/find-replace";
import type { DeckSnapshot } from "~/components/slides/deck/snapshot";
import { comboMatches, SHORTCUTS } from "./shortcuts";
import type { DeckDoc } from "./useDeckDoc";

export interface DeckFind {
  open: boolean;
  focusKey: number;
  query: string;
  replacement: string;
  matchCase: boolean;
  matches: FindMatch[];
  current: number;
  setQuery: (q: string) => void;
  setReplacement: (r: string) => void;
  setMatchCase: (on: boolean) => void;
  show: (seed?: string) => void;
  close: () => void;
  next: () => void;
  prev: () => void;
  replaceCurrent: () => void;
  replaceAll: () => void;
}

const findCombo = SHORTCUTS.find((s) => s.id === "find")!.combos![0];
const SEED_MAX = 80;

/** Find and replace across every slide's text and notes. Stepping selects the slide and the text box. */
export function useDeckFind({
  deck,
  snap,
  editable,
  onReveal,
}: {
  deck: DeckDoc | null;
  snap: DeckSnapshot;
  editable: boolean;
  onReveal: (slideId: string, key: string | null) => void;
}): DeckFind {
  const [open, setOpen] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const [query, setQueryState] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [cursor, setCursor] = useState(0);
  const reveal = useRef(onReveal);
  reveal.current = onReveal;

  const matches = useMemo(() => (deck && open ? findMatches(deck.doc, query, { matchCase }) : []), [deck, open, query, matchCase, snap]);
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const current = matches.length === 0 ? 0 : Math.min(cursor, matches.length - 1);

  const go = useCallback(
    (index: number, list: FindMatch[]) => {
      if (list.length === 0) return;
      const at = ((index % list.length) + list.length) % list.length;
      setCursor(at);
      reveal.current(list[at].slideId, list[at].key);
    },
    [],
  );

  useEffect(() => {
    const first = matchesRef.current[0];
    if (open && first) reveal.current(first.slideId, first.key);
  }, [open, query, matchCase]);

  const show = useCallback((seed?: string) => {
    setOpen(true);
    setFocusKey((k) => k + 1);
    if (seed) setQueryState(seed);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if (!comboMatches(e, findCombo)) return;
      e.preventDefault();
      const selected = window.getSelection()?.toString() ?? "";
      show(selected && !selected.includes("\n") && selected.length <= SEED_MAX ? selected : undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, show]);

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
    setCursor(0);
  }, []);

  const replaceCurrent = useCallback(() => {
    if (!deck || matches.length === 0) return;
    const target = matches[current];
    deck.undo.step(() => replaceMatches(deck.doc, [target], replacement));
    const again = replacement.toLowerCase().includes(query.toLowerCase());
    const after = findMatches(deck.doc, query, { matchCase });
    go(again ? current + 1 : current, after);
  }, [deck, matches, current, replacement, query, matchCase, go]);

  const replaceAll = useCallback(() => {
    if (!deck || matches.length === 0) return;
    deck.undo.step(() => replaceMatches(deck.doc, matches, replacement));
    setCursor(0);
  }, [deck, matches, replacement]);

  return {
    open,
    focusKey,
    query,
    replacement,
    matchCase,
    matches,
    current,
    setQuery,
    setReplacement,
    setMatchCase,
    show,
    close,
    next: () => go(current + 1, matches),
    prev: () => go(current - 1, matches),
    replaceCurrent,
    replaceAll,
  };
}
