// DocCommentsRail — Google-Docs-style right-margin comments rail.
//
// Must be rendered as a child of BlockNoteView (for editor context access).
// DocumentEditor portals this into a rail container div sitting to the right
// of the paper canvas. The rail is only mounted when the canvas is wide enough
// (≥ 1150px, measured by the host via ResizeObserver on the canvas container).
//
// Layout model: the rail container is a position:relative column in the SAME
// page flow as the paper (no sticky, no inner scrollbar) — cards are
// absolutely positioned at their mark's offset so mark↔card alignment holds
// at every scroll position, exactly like Google Docs margin comments. Cards
// that would overlap are pushed down using their real rendered heights
// (min 8px gap). Threads without marks (doc-level or orphaned) appear at the
// bottom in flow under a "General" divider.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import { MessageSquare } from "lucide-react";
import { CommentsExtension } from "@blocknote/core/comments";
import type { ThreadData } from "@blocknote/core/comments";
import {
  Thread,
  getReferenceText,
  useThreads,
} from "@blocknote/react";
import { useBlockNoteEditor } from "@blocknote/react";
import { useExtension, useExtensionState } from "@blocknote/react";

// How DocEditorImpl talks to the rail via comments config.
export interface DocCommentsRailProps {
  filter: "open" | "resolved";
  onFilterChange: (f: "open" | "resolved") => void;
  /** Ref to the paper card element (mark-measure query root + resize watch). */
  editorContentRef: React.RefObject<HTMLElement | null>;
  /** Deep-linked comment id (?comment=) — select + scroll once threads load. */
  focusCommentId?: string;
}

const CARD_FALLBACK_H = 100;
const CARD_GAP = 8;

function mapsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

// ─── DocCommentsRail ────────────────────────────────────────────────────────

export function DocCommentsRail({
  filter,
  onFilterChange,
  editorContentRef,
  focusCommentId,
}: DocCommentsRailProps) {
  const editor = useBlockNoteEditor<any, any, any>();
  const comments = useExtension(CommentsExtension);
  const { selectedThreadId, threadPositions } = useExtensionState(CommentsExtension);
  const threads = useThreads();

  // top values keyed by thread id: px from the top of the cards region (which
  // top-aligns with the paper card, so these match mark offsets in the paper).
  const [cardTops, setCardTops] = useState<Map<string, number>>(new Map());

  // The absolute-positioning region (starts right below the rail header).
  const regionRef = useRef<HTMLDivElement | null>(null);
  // Real rendered card elements, for height-aware overlap resolution.
  const cardEls = useRef<Map<string, HTMLElement>>(new Map());

  // Thread ids visible under the current filter — measurement ignores marks of
  // hidden threads so their reserved space doesn't leave gaps.
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of threads.values()) {
      if ((filter === "resolved") === Boolean(t.resolved)) ids.add(t.id);
    }
    return ids;
  }, [threads, filter]);

  // Measure mark offsets relative to the cards region, then resolve overlaps
  // using each card's real rendered height. Offsets are scroll-invariant (mark
  // and region live in the same scrolling flow), so scrolling never needs a
  // re-measure.
  const measure = useCallback(() => {
    const root = editorContentRef.current;
    const region = regionRef.current;
    if (!root || !region) return;
    const regionTop = region.getBoundingClientRect().top;

    // Collect (threadId → raw offset) from the first mark span per thread.
    const rawTops = new Map<string, number>();
    const markEls = root.querySelectorAll<HTMLElement>(".bn-thread-mark[data-bn-thread-id]");
    for (const el of markEls) {
      const tid = el.getAttribute("data-bn-thread-id");
      if (!tid || rawTops.has(tid) || !visibleIds.has(tid)) continue; // first mark wins (top of range)
      rawTops.set(tid, Math.max(0, el.getBoundingClientRect().top - regionTop));
    }

    // Sort by position, then push cards down when they'd overlap.
    const anchored = Array.from(rawTops.entries()).sort((a, b) => a[1] - b[1]);
    const resolved = new Map<string, number>();
    let cursor = 0;
    for (const [tid, rawTop] of anchored) {
      const top = Math.max(rawTop, cursor);
      resolved.set(tid, top);
      const h = cardEls.current.get(tid)?.offsetHeight ?? CARD_FALLBACK_H;
      cursor = top + h + CARD_GAP;
    }

    // Only commit real changes — card ResizeObservers re-enter measure after
    // every layout pass, and an identical Map would loop the render cycle.
    setCardTops((prev) => (mapsEqual(prev, resolved) ? prev : resolved));
  }, [editorContentRef, visibleIds]);

  // Stable identity for observers that outlive `measure` recreations.
  const measureRef = useRef(measure);
  measureRef.current = measure;

  // Card elements are observed so growth (replies, composer opening) reflows
  // the push-down stack immediately.
  const cardsRO = useRef<ResizeObserver | null>(null);
  const registerCard = useCallback((tid: string, el: HTMLElement | null) => {
    const ro = (cardsRO.current ??= new ResizeObserver(() =>
      requestAnimationFrame(() => measureRef.current()),
    ));
    const prev = cardEls.current.get(tid);
    if (prev && prev !== el) ro.unobserve(prev);
    if (el) {
      cardEls.current.set(tid, el);
      ro.observe(el);
    } else {
      cardEls.current.delete(tid);
    }
  }, []);
  useEffect(() => () => cardsRO.current?.disconnect(), []);

  // Re-measure on editor content changes.
  useEffect(() => {
    const unsubscribe = editor.onChange(() => {
      // Defer one tick so the DOM has been updated by the browser.
      requestAnimationFrame(() => measureRef.current());
    });
    // Initial measurement.
    measure();
    return () => { unsubscribe?.(); };
  }, [editor, measure]);

  // Re-measure on image loads and ResizeObserver on the editor content.
  useEffect(() => {
    const el = editorContentRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => requestAnimationFrame(() => measureRef.current()));
    ro.observe(el);

    // Also watch images inside for load events.
    function onLoad() { requestAnimationFrame(() => measureRef.current()); }
    el.addEventListener("load", onLoad, true); // capture so img events bubble up

    return () => {
      ro.disconnect();
      el.removeEventListener("load", onLoad, true);
    };
  }, [editorContentRef]);

  // Re-measure when thread set or positions change (new threads, resolved, etc.)
  useEffect(() => {
    requestAnimationFrame(() => measureRef.current());
  }, [threads, threadPositions, measure]);

  // Deep link (?comment=<id>): once the thread exists, select it + flash its
  // mark. The id may be a reply — resolve to the containing thread.
  const focusedOnceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusCommentId || focusedOnceRef.current === focusCommentId) return;
    let threadId: string | undefined = threads.has(focusCommentId) ? focusCommentId : undefined;
    if (!threadId) {
      for (const t of threads.values()) {
        if (t.comments.some((c) => c.id === focusCommentId)) { threadId = t.id; break; }
      }
    }
    if (!threadId) return; // threads still loading — retry on next update
    const tid = threadId;
    focusedOnceRef.current = focusCommentId;
    comments.selectThread(tid, false);
    // The collab doc may not have synced its marks yet (threads come from the
    // REST store, marks from Yjs) — poll briefly until the mark exists.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const attempt = () => {
      if (findMarkEl(tid)) {
        scrollMarkIntoView(tid);
        flashMark(tid);
      } else if (++tries < 40) {
        timer = setTimeout(attempt, 250);
      }
    };
    attempt();
    return () => { if (timer) clearTimeout(timer); };
  }, [focusCommentId, threads, comments]);

  // Split threads into anchored (have a measured mark) vs unanchored
  // (doc-level / orphaned).
  const { anchored, unanchored } = useMemo(() => {
    const threadsArray = Array.from(threads.values());
    const visible = threadsArray.filter((t) => visibleIds.has(t.id));

    const anch: Array<{ thread: ThreadData; referenceText: string; orphaned: boolean }> = [];
    const unanch: Array<{ thread: ThreadData; referenceText: string; orphaned: boolean }> = [];

    for (const thread of visible) {
      const pos = threadPositions.get(thread.id);
      const orphaned = pos === undefined;
      const referenceText = getReferenceText(editor, pos);
      if (cardTops.has(thread.id)) {
        anch.push({ thread, referenceText, orphaned });
      } else {
        unanch.push({ thread, referenceText, orphaned });
      }
    }

    // Sort anchored by card top.
    anch.sort((a, b) => (cardTops.get(a.thread.id) ?? 0) - (cardTops.get(b.thread.id) ?? 0));

    return { anchored: anch, unanchored: unanch };
  }, [threads, threadPositions, cardTops, visibleIds, editor]);

  // The region's min-height: bottom edge of the lowest card (real height), so
  // the in-flow "General" section lands below the anchored stack.
  const anchoredRegionHeight = useMemo(() => {
    let max = 0;
    for (const [tid, top] of cardTops) {
      const h = cardEls.current.get(tid)?.offsetHeight ?? CARD_FALLBACK_H;
      if (top + h > max) max = top + h;
    }
    return max > 0 ? max + CARD_GAP : 0;
  }, [cardTops]);

  const totalThreadCount = threads.size;
  const openCount = Array.from(threads.values()).filter((t) => !t.resolved).length;
  const displayCount = filter === "resolved" ? totalThreadCount - openCount : openCount;

  const select = useCallback(
    (threadId: string) => {
      // false = skip the extension's own scroll (it can throw on text-node
      // anchors); we scroll + flash the mark element ourselves.
      comments.selectThread(threadId, false);
      flashMark(threadId);
      scrollMarkIntoView(threadId);
    },
    [comments],
  );
  const deselect = useCallback(() => comments.selectThread(undefined), [comments]);

  return (
    <div className="dali-doc-rail">
      {/* Rail header */}
      <div className="dali-doc-rail__header flex items-center justify-between px-1 pb-2">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent-coral/15">
            <MessageSquare className="w-3 h-3 text-accent-coral" />
          </span>
          <span className="text-xs font-semibold text-foreground">Comments</span>
          {displayCount > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {displayCount}
            </span>
          )}
        </div>
        <div className="inline-flex rounded-full bg-muted/60 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => onFilterChange("open")}
            className={`rounded-full px-2 py-0.5 transition-colors ${
              filter === "open"
                ? "bg-card font-semibold text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => onFilterChange("resolved")}
            className={`rounded-full px-2 py-0.5 transition-colors ${
              filter === "resolved"
                ? "bg-card font-semibold text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Resolved
          </button>
        </div>
      </div>

      {/* Absolutely-positioned anchored cards. The region top-aligns with the
          paper card top minus the header height — measure() anchors to the
          region itself, so header height never skews card offsets. */}
      <div
        ref={regionRef}
        className="dali-doc-rail__region"
        style={{ minHeight: anchoredRegionHeight }}
      >
        {anchored.map(({ thread, referenceText, orphaned }) => (
          <RailCard
            key={thread.id}
            thread={thread}
            selectedThreadId={selectedThreadId}
            referenceText={referenceText}
            orphaned={orphaned}
            top={cardTops.get(thread.id) ?? 0}
            registerEl={registerCard}
            onSelect={select}
            onDeselect={deselect}
          />
        ))}
      </div>

      {/* Unanchored (doc-level / orphaned) threads at the bottom */}
      {unanchored.length > 0 && (
        <div className="pb-4">
          <div className="flex items-center gap-2 py-2">
            <div className="flex-1 border-t border-border" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">General</span>
            <div className="flex-1 border-t border-border" />
          </div>
          <div className="flex flex-col gap-2">
            {unanchored.map(({ thread, referenceText, orphaned }) => (
              <RailCard
                key={thread.id}
                thread={thread}
                selectedThreadId={selectedThreadId}
                referenceText={referenceText}
                orphaned={orphaned}
                top={null}
                registerEl={registerCard}
                onSelect={select}
                onDeselect={deselect}
              />
            ))}
          </div>
        </div>
      )}

      {anchored.length === 0 && unanchored.length === 0 && (
        <p className="text-xs text-muted-foreground italic px-1 py-2">
          {filter === "resolved" ? "No resolved comments." : "No comments yet. Select text to add a comment."}
        </p>
      )}
    </div>
  );
}

// ─── RailCard ────────────────────────────────────────────────────────────────

interface RailCardProps {
  thread: ThreadData;
  selectedThreadId: string | undefined;
  referenceText: string;
  orphaned: boolean;
  /** null = flow (for unanchored). */
  top: number | null;
  registerEl: (threadId: string, el: HTMLElement | null) => void;
  onSelect: (threadId: string) => void;
  onDeselect: () => void;
}

function RailCard({
  thread,
  selectedThreadId,
  referenceText,
  orphaned,
  top,
  registerEl,
  onSelect,
  onDeselect,
}: RailCardProps) {
  const selected = thread.id === selectedThreadId;
  const cardRef = useRef<HTMLDivElement | null>(null);

  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      cardRef.current = el;
      registerEl(thread.id, el);
    },
    [registerEl, thread.id],
  );

  // Only select (and scroll/flash the mark) when not already selected — a
  // click inside an open card's reply composer must not yank the scroll.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const selectOnce = useCallback(() => {
    if (!selectedRef.current) onSelect(thread.id);
  }, [onSelect, thread.id]);

  const onFocus = useCallback(
    (e: FocusEvent) => {
      if ((e.target as HTMLElement).closest(".bn-action-toolbar")) return;
      selectOnce();
    },
    [selectOnce],
  );

  // Keep the card open while focus stays inside it — including BlockNote's
  // action toolbar and any floating-portal UI (dropdown menus, emoji pickers)
  // that render outside the card's DOM subtree.
  const onBlur = useCallback(
    (e: FocusEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (!related) return;
      if (cardRef.current?.contains(related)) return;
      if (
        related.closest(
          ".bn-action-toolbar, [data-floating-ui-portal], [data-radix-popper-content-wrapper], [data-slot='dropdown-menu-content'], [data-slot='popover-content']",
        )
      ) return;
      onDeselect();
    },
    [onDeselect],
  );

  const style: React.CSSProperties =
    top !== null
      ? { position: "absolute", top, left: 0, right: 0 }
      : {};

  return (
    <div
      ref={setRef}
      data-thread-id={thread.id}
      className={`dali-doc-rail__card${selected ? " dali-doc-rail__card--selected" : ""}`}
      style={style}
      // Clicking the card wrapper (not Thread's own focus handler) also selects.
      onClick={selectOnce}
    >
      <Thread
        thread={thread}
        selected={selected}
        orphaned={orphaned}
        referenceText={referenceText}
        maxCommentsBeforeCollapse={3}
        onFocus={onFocus}
        onBlur={onBlur}
        tabIndex={0}
      />
    </div>
  );
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function findMarkEl(threadId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `.bn-thread-mark[data-bn-thread-id="${CSS.escape(threadId)}"]`,
  );
}

function scrollMarkIntoView(threadId: string) {
  const el = findMarkEl(threadId);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
}

const FLASH_CLASS = "bn-thread-mark-flash";

function flashMark(threadId: string) {
  const els = document.querySelectorAll<HTMLElement>(
    `.bn-thread-mark[data-bn-thread-id="${CSS.escape(threadId)}"]`,
  );
  for (const el of els) {
    el.classList.add(FLASH_CLASS);
    setTimeout(() => el.classList.remove(FLASH_CLASS), 1500);
  }
}
