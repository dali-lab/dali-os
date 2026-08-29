// Mention inline content: chip renderer + "@" suggestion items backed by the
// real member-search endpoint. Port of app/components/editor/mention.tsx —
// the stored shape {id, label: handle} is 1:1 with the TipTap node attrs
// (extractMentionUserIds and the PM→BlockNote mapper depend on it).
//
// Page mentions (pageMention node) are a separate spec with stored shape
// {pageId, label: title snapshot}. A separate node type means the server
// walkers can distinguish user vs page mentions without inspecting props, and
// existing persisted "mention" nodes are fully backward-compatible.

import { createReactInlineContentSpec } from "@blocknote/react";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
// Type-only: erased at runtime, so no module cycle with build.ts (which
// imports MentionSpec as a value).
import type { DocEditorInstance } from "./build";
import { mentionConfig, pageMentionConfig } from "./configs";
import { MentionHoverCard } from "./MentionHoverCard";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type MentionUser = {
  id: string;
  name: string;
  handle: string;
  photoUrl?: string | null;
};

export type MentionPage = {
  id: string;
  title: string;
  iconEmoji?: string | null;
};

// Same chip styling as the legacy MENTION_CLASS.
const MENTION_CLASS =
  "rounded bg-accent-coral/15 px-1 py-0.5 font-medium text-accent-coral";

// Page mention chip: muted blue tint to visually distinguish from @user coral
// mentions. Click navigates to the page (window.location so it works inside
// the contenteditable tree in both editable and read-only contexts).
const PAGE_MENTION_CLASS =
  "rounded bg-primary/10 px-1 py-0.5 font-medium text-primary cursor-pointer hover:bg-primary/20";

// ─── Live page-title resolution ──────────────────────────────────────────────
//
// The stored `label` prop is a snapshot taken at insertion time. Pages can be
// renamed after insertion. This context resolves pageIds → current titles from
// the server and caches results so all chips in a document share one request.
//
// Design:
//  - PageMentionTitleProvider collects pageIds registered by rendered chips
//    and fires ONE batched fetch after a short debounce (16 ms — next frame).
//  - Already-resolved ids are served from the cache without a new request.
//  - While loading or if the server omits an id (archived/no-access), the chip
//    falls back to its stored `label` — never blank, never an error.
//  - The context default is a no-op hook that returns the fallback, so chips
//    render fine in any tree that doesn't mount the provider.

type TitleCache = Record<string, string>;

interface PageMentionTitleCtx {
  // Register a pageId for resolution; returns the current resolved title or
  // undefined if not yet resolved (caller falls back to stored label).
  register: (pageId: string) => string | undefined;
  // Resolved title cache (stable reference changes trigger re-renders).
  cache: TitleCache;
}

const noop = () => undefined;
const defaultCtx: PageMentionTitleCtx = { register: noop, cache: {} };

const PageMentionTitleContext = createContext<PageMentionTitleCtx>(defaultCtx);

/** Mount once near the doc editor root to enable live page-title resolution. */
export function PageMentionTitleProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolved title cache; state so updates cause chip re-renders.
  const [cache, setCache] = useState<TitleCache>({});

  // Pending ids queued since the last flush.
  const pendingRef = useRef<Set<string>>(new Set());
  // Ids already fetched (resolved or confirmed absent) — skip re-fetching.
  const fetchedRef = useRef<Set<string>>(new Set());
  // Debounce timer handle.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = new Set();
    const toFetch = [...pending].filter((id) => !fetchedRef.current.has(id));
    if (toFetch.length === 0) return;

    // Mark as fetched before the request so concurrent flushes don't double-fetch.
    for (const id of toFetch) fetchedRef.current.add(id);

    try {
      const res = await fetch(
        `/api/mentions/pages/resolve?ids=${toFetch.map(encodeURIComponent).join(",")}`,
        { credentials: "include" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { titles?: TitleCache };
      const titles = data.titles;
      if (!titles || typeof titles !== "object") return;
      setCache((prev) => {
        // Only update state if there is new data to merge in.
        const hasNew = Object.keys(titles).some((id) => prev[id] !== titles[id]);
        return hasNew ? { ...prev, ...titles } : prev;
      });
    } catch {
      // Network errors are silenced; chips display their stored label fallback.
    }
  }, []);

  const register = useCallback(
    (pageId: string): string | undefined => {
      // If already cached, return immediately.
      // Even if absent from cache (not fetched yet OR inaccessible after fetch),
      // we still queue the id on the first encounter to ensure we tried once.
      if (!fetchedRef.current.has(pageId)) {
        pendingRef.current.add(pageId);
        // Debounce: coalesce registrations arriving in the same render pass.
        if (!timerRef.current) {
          timerRef.current = setTimeout(flush, 16);
        }
      }
      // Return undefined if not yet resolved; caller uses stored label.
      return cache[pageId];
    },
    [cache, flush],
  );

  // Clean up the debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const ctx: PageMentionTitleCtx = { register, cache };
  return (
    <PageMentionTitleContext.Provider value={ctx}>
      {children}
    </PageMentionTitleContext.Provider>
  );
}

/**
 * Returns the live page title for `pageId`, falling back to `fallbackLabel`
 * while loading or when the page is inaccessible/archived. Safe to call
 * outside a `PageMentionTitleProvider` (returns fallbackLabel in that case).
 */
function usePageMentionTitle(pageId: string, fallbackLabel: string): string {
  const ctx = useContext(PageMentionTitleContext);
  const resolved = ctx.register(pageId);
  return resolved ?? fallbackLabel;
}

// ─── Specs ───────────────────────────────────────────────────────────────────

export const MentionSpec = createReactInlineContentSpec(mentionConfig, {
  render: ({ inlineContent }) => (
    <MentionHoverCard userId={inlineContent.props.id}>
      <span className={MENTION_CLASS} data-mention-id={inlineContent.props.id}>
        @{inlineContent.props.label}
      </span>
    </MentionHoverCard>
  ),
});

export const PageMentionSpec = createReactInlineContentSpec(pageMentionConfig, {
  render: ({ inlineContent }) => {
    const pageId = inlineContent.props.pageId;
    const storedLabel = inlineContent.props.label || "Untitled";
    // usePageMentionTitle registers the pageId with the nearest
    // PageMentionTitleProvider and returns the live title once resolved.
    // Falls back to the stored snapshot gracefully (no-op outside provider).
    const label = usePageMentionTitle(pageId, storedLabel);
    return (
      <span
        className={PAGE_MENTION_CLASS}
        data-page-mention-id={pageId}
        onClick={(e) => {
          e.preventDefault();
          if (pageId) window.location.href = `/documents/${pageId}`;
        }}
        title={`Open page: ${label}`}
      >
        📄 {label}
      </span>
    );
  },
});

/** Thin wrapper over the member-search endpoint (session-authed). */
export async function searchMentionableUsers(q: string): Promise<MentionUser[]> {
  try {
    const res = await fetch(`/api/mentions/search?q=${encodeURIComponent(q)}`, {
      credentials: "include",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { members?: MentionUser[] };
    return data.members ?? [];
  } catch {
    return [];
  }
}

/** Thin wrapper over the page-mention search endpoint (session-authed, permission-scoped). */
export async function searchMentionablePages(q: string): Promise<MentionPage[]> {
  try {
    const res = await fetch(
      `/api/mentions/pages?q=${encodeURIComponent(q)}`,
      { credentials: "include" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { pages?: MentionPage[] };
    return data.pages ?? [];
  } catch {
    return [];
  }
}

/**
 * Async "@" suggestion items for SuggestionMenuController. Returns People
 * first (group: "People"), then Pages (group: "Pages"). Both are filtered
 * server-side so BlockNote's local filterSuggestionItems is skipped.
 */
export async function getMentionMenuItems(
  editor: DocEditorInstance,
  query: string,
  searchUsers: (q: string) => Promise<MentionUser[]> = searchMentionableUsers,
  searchPages: (q: string) => Promise<MentionPage[]> = searchMentionablePages,
): Promise<DefaultReactSuggestionItem[]> {
  const [users, pages] = await Promise.all([
    searchUsers(query),
    searchPages(query),
  ]);

  const userItems: DefaultReactSuggestionItem[] = users.map((user) => ({
    title: user.name,
    subtext: `@${user.handle}`,
    group: "People",
    onItemClick: () => {
      editor.insertInlineContent([
        { type: "mention", props: { id: user.id, label: user.handle } },
        " ",
      ]);
    },
  }));

  const pageItems: DefaultReactSuggestionItem[] = pages.map((page) => ({
    title: page.title || "Untitled",
    subtext: "Page",
    group: "Pages",
    onItemClick: () => {
      editor.insertInlineContent([
        {
          type: "pageMention",
          props: { pageId: page.id, label: page.title || "Untitled" },
        },
        " ",
      ]);
    },
  }));

  return [...userItems, ...pageItems];
}
