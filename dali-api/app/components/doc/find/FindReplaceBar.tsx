/**
 * FindReplaceBar — host-owned floating panel above the editor.
 *
 * Rendered by DocumentEditor (not DocEditorImpl) so it sits at the same
 * altitude as the Aa popover: inside the doc surface but outside the BlockNote
 * view tree. The bar drives the ProseMirror find/replace plugin via
 * editor.prosemirrorView.dispatch().
 *
 * Props:
 *   editor      — live BlockNoteEditor instance (from onEditorReady callback)
 *   canEdit     — hides the Replace row when the viewer is read-only
 *   onClose     — called when the bar should be dismissed
 *   initialQuery — prefill the search input (selected text on ⌘F)
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ChevronUp, ChevronDown, X, ChevronsUpDown } from "lucide-react";
import type { BlockNoteEditor } from "@blocknote/core";
import { findReplaceKey, type FindPluginState, type FindPluginUpdate } from "./FindReplacePlugin";

interface FindReplaceBarProps {
  editor: BlockNoteEditor<any, any, any>;
  canEdit: boolean;
  onClose: () => void;
  initialQuery?: string;
}

export function FindReplaceBar({ editor, canEdit, onClose, initialQuery = "" }: FindReplaceBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState("");
  const [replaceExpanded, setReplaceExpanded] = useState(false);
  const queryRef = useRef<HTMLInputElement>(null);

  // Read current plugin state from the PM view.
  const getPluginState = useCallback((): FindPluginState | null => {
    const view = editor.prosemirrorView;
    if (!view) return null;
    return findReplaceKey.getState(view.state) ?? null;
  }, [editor]);

  // Derived display values — re-read from plugin state after each dispatch.
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(-1);

  const syncFromPlugin = useCallback(() => {
    const ps = getPluginState();
    if (!ps) return;
    setMatchCount(ps.matches.length);
    setCurrentMatch(ps.current);
  }, [getPluginState]);

  // Dispatch a find update to the PM plugin.
  const dispatchFind = useCallback(
    (update: FindPluginUpdate) => {
      const view = editor.prosemirrorView;
      if (!view) return;
      const tr = view.state.tr.setMeta(findReplaceKey, update);
      view.dispatch(tr);
      syncFromPlugin();
    },
    [editor, syncFromPlugin],
  );

  // Scroll the current match's decoration DOM node into view.
  const scrollCurrentIntoView = useCallback(() => {
    const view = editor.prosemirrorView;
    if (!view) return;
    const el = view.dom.querySelector<HTMLElement>(".dali-find-match--current");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [editor]);

  // Run search whenever query changes (debounced 80ms to avoid thrashing on fast
  // typing, but short enough to feel live).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      dispatchFind({ needle: query, current: 0 });
      // Scroll after state has settled.
      requestAnimationFrame(() => {
        scrollCurrentIntoView();
        syncFromPlugin();
      });
    }, 80);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Re-sync after doc changes so counts stay accurate.
  // We subscribe to editor.onChange which fires for local + collab edits.
  useEffect(() => {
    const unsubscribe = editor.onChange(() => {
      // The plugin already recomputes on docChanged transactions; we just need
      // to pull the refreshed counts into React state.
      syncFromPlugin();
    });
    return () => { unsubscribe?.(); };
  }, [editor, syncFromPlugin]);

  // Focus the input on mount.
  useEffect(() => {
    queryRef.current?.focus();
    queryRef.current?.select();
  }, []);

  // Seed the query with initialQuery when it changes (⌘F with selection).
  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
    }
  // Only seed on initialQuery identity change, not on internal state changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  // Cleanup: clear all decorations when the bar unmounts.
  useEffect(() => {
    return () => {
      const view = editor.prosemirrorView;
      if (!view) return;
      const tr = view.state.tr.setMeta(findReplaceKey, { needle: "", current: -1 } as FindPluginUpdate);
      view.dispatch(tr);
    };
  }, [editor]);

  function navigate(direction: "next" | "prev") {
    const ps = getPluginState();
    if (!ps || ps.matches.length === 0) return;
    const next =
      direction === "next"
        ? (ps.current + 1) % ps.matches.length
        : (ps.current - 1 + ps.matches.length) % ps.matches.length;
    dispatchFind({ current: next });
    requestAnimationFrame(scrollCurrentIntoView);
  }

  // Replace helpers — operate via PM transactions on the prosemirrorView.
  function replaceCurrent() {
    const view = editor.prosemirrorView;
    if (!view) return;
    const ps = getPluginState();
    if (!ps || ps.matches.length === 0 || ps.current < 0) return;
    const m = ps.matches[ps.current];
    const tr = view.state.tr.replaceWith(
      m.from,
      m.to,
      // Preserve marks at the replacement position.
      view.state.schema.text(replacement, view.state.doc.resolve(m.from).marks()),
    );
    // Advance to the next match after replace; the plugin will recompute.
    const nextCurrent = ps.current < ps.matches.length - 1 ? ps.current : Math.max(0, ps.matches.length - 2);
    tr.setMeta(findReplaceKey, { recompute: true, current: nextCurrent } as FindPluginUpdate);
    view.dispatch(tr);
    syncFromPlugin();
  }

  function replaceAll() {
    const view = editor.prosemirrorView;
    if (!view) return;
    const ps = getPluginState();
    if (!ps || ps.matches.length === 0) return;

    // Build one transaction with all replacements in reverse order (so earlier
    // positions don't shift later ones). Single transaction = single undo step.
    let tr = view.state.tr;
    const sorted = [...ps.matches].sort((a, b) => b.from - a.from);
    for (const m of sorted) {
      const marks = view.state.doc.resolve(m.from).marks();
      tr = tr.replaceWith(m.from, m.to, view.state.schema.text(replacement, marks));
    }
    tr.setMeta(findReplaceKey, { recompute: true, current: 0 } as FindPluginUpdate);
    view.dispatch(tr);
    syncFromPlugin();
  }

  // Keyboard: Esc closes, Enter = next, Shift+Enter = prev.
  function onQueryKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      navigate(e.shiftKey ? "prev" : "next");
    }
  }

  function onReplaceKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  function close() {
    onClose();
  }

  const countLabel =
    matchCount === 0
      ? query ? "No results" : ""
      : `${currentMatch + 1} of ${matchCount}`;

  return (
    <div
      className="dali-find-bar"
      role="search"
      aria-label="Find and replace"
      // Prevent mousedown from stealing editor focus/selection.
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Row 1: search */}
      <div className="dali-find-bar__row">
        {/* Toggle replace row */}
        <button
          type="button"
          onClick={() => setReplaceExpanded((v) => !v)}
          aria-label={replaceExpanded ? "Collapse replace" : "Expand replace"}
          aria-expanded={replaceExpanded}
          className="dali-find-bar__toggle"
          title={replaceExpanded ? "Hide replace" : "Show replace"}
        >
          <ChevronsUpDown className="h-3.5 w-3.5" />
        </button>

        <input
          ref={queryRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onQueryKeyDown}
          placeholder="Find…"
          aria-label="Find"
          className="dali-find-bar__input"
          // Allow real focus/keyboard events — override the outer onMouseDown.
          onMouseDown={(e) => e.stopPropagation()}
        />

        {/* n of m */}
        <span className="dali-find-bar__count" aria-live="polite">
          {countLabel}
        </span>

        <button
          type="button"
          onClick={() => navigate("prev")}
          disabled={matchCount === 0}
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
          className="dali-find-bar__nav"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => navigate("next")}
          disabled={matchCount === 0}
          aria-label="Next match"
          title="Next match (Enter)"
          className="dali-find-bar__nav"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={close}
          aria-label="Close find bar"
          title="Close (Esc)"
          className="dali-find-bar__close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Row 2: replace — only when expanded AND canEdit */}
      {replaceExpanded && canEdit && (
        <div className="dali-find-bar__row dali-find-bar__row--replace">
          <input
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={onReplaceKeyDown}
            placeholder="Replace with…"
            aria-label="Replace with"
            className="dali-find-bar__input dali-find-bar__input--replace"
            onMouseDown={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={replaceCurrent}
            disabled={matchCount === 0}
            className="dali-find-bar__action"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={replaceAll}
            disabled={matchCount === 0}
            className="dali-find-bar__action"
          >
            Replace all
          </button>
        </div>
      )}
    </div>
  );
}
