// DocCommentsPanel — right-panel comments UI for the documents page.
//
// The panel has two sections:
//   1. Inline threads: rendered via BlockNote's <ThreadsSidebar> portaled into
//      the panel container. ThreadsSidebar must live inside a BlockNoteView
//      context — DocEditorImpl creates the portal when panelOpen is true, using
//      the element with id=panelTargetId as its mount point.
//   2. Doc-level threads (anchor=null): rendered by this component from the
//      shared /api/comments fetch, with a composer strip at the bottom.
//
// The panel is a fixed right-side overlay; it does NOT push the editor.
// W1 mounts this at the page level and passes open/onClose; DocEditorImpl
// reads comments.panelOpen + comments.panelTargetId to drive the portal.

import { useEffect, useRef, useState, useSyncExternalStore, useCallback } from "react";
import { MessageSquare, Check, RotateCcw, Trash2 } from "lucide-react";

import { Avatar } from "~/components/ui/Avatar";
import { MentionTextInput } from "~/components/MentionTextInput";
import { DaliThreadStore, getOrCreateStore } from "./DaliThreadStore";

// ── Props ────────────────────────────────────────────────────────────────────

export interface DocCommentsPanelProps {
  pageId: string;
  currentUserId: string;
  canComment: boolean;
  canResolve: boolean;
  open: boolean;
  onClose: () => void;
  /** DOM id of the div inside the panel where ThreadsSidebar should portal. */
  targetId?: string;
  /** "dropdown" floats it under a trigger button; "inline" sits it in the flow
   *  at the foot of the document, which is where comments live on narrow
   *  screens now that there's no button to open them from. */
  variant?: "dropdown" | "inline";
  /** Called when the Open/Resolved tab changes so the editor's ThreadsSidebar
   * portal can mirror the same filter (Fix 4). */
  onFilterChange?: (filter: "open" | "resolved") => void;
}

// ── useDocThreadCounts ───────────────────────────────────────────────────────
//
// Lightweight hook used by W1 to show a bubble count on the Comments button.
// Uses the shared getOrCreateStore registry from DaliThreadStore.ts so this
// hook, DocEditorImpl's CommentsExtension store, and DocCommentsPanel all read
// from the same in-memory thread map — mutations update the count immediately.

export function useDocThreadCounts(pageId: string): { open: number; resolved: number } {
  const store = getOrCreateStore(pageId);

  const subscribe = useCallback(
    (notify: () => void) => store.subscribe((_threads) => notify()),
    [store],
  );
  const getSnapshot = useCallback(() => store.getThreads(), [store]);

  const threads = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  let open = 0;
  let resolved = 0;
  for (const t of threads.values()) {
    if (t.resolved) resolved++;
    else open++;
  }
  return { open, resolved };
}

// ── Doc-level comment types (fetched independently) ─────────────────────────

interface ApiComment {
  id: string;
  parentId: string | null;
  author: string;
  authorId: string;
  authorPhotoUrl?: string | null;
  body: string;
  anchor: { kind?: string; from?: string; to?: string } | null;
  resolved: boolean;
  createdAt: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── DocCommentsPanel ─────────────────────────────────────────────────────────

export function DocCommentsPanel({
  pageId,
  currentUserId,
  canComment,
  canResolve,
  open,
  onClose,
  targetId = "doc-comments-threads-sidebar",
  onFilterChange,
  variant = "dropdown",
}: DocCommentsPanelProps) {
  const inline = variant === "inline";
  const [filter, setFilter] = useState<"open" | "resolved">("open");

  function handleFilterChange(next: "open" | "resolved") {
    setFilter(next);
    onFilterChange?.(next);
  }

  // Doc-level comments (anchor = null): independent fetch, not in ThreadStore.
  const [docComments, setDocComments] = useState<ApiComment[]>([]);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [postErr, setPostErr] = useState<string | null>(null);
  const mounted = useRef(false);

  const fetchDocComments = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/comments?targetType=doc&targetId=${encodeURIComponent(pageId)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        setFetchErr(
          res.status === 403
            ? "You don't have access to comments here."
            : `Failed to load comments (${res.status}).`,
        );
        return;
      }
      setFetchErr(null);
      const { comments } = (await res.json()) as { comments: ApiComment[] };
      // Only doc-level (anchor = null) threads in this section.
      if (mounted.current) setDocComments(comments.filter((c) => c.anchor === null));
    } catch {
      // Network errors are non-fatal; panel shows stale data.
    }
  }, [pageId]);

  useEffect(() => {
    mounted.current = true;
    if (open) void fetchDocComments();
    return () => { mounted.current = false; };
  }, [open, fetchDocComments]);

  async function postDocComment(body: string, parentId: string | null) {
    setBusy(true);
    setPostErr(null);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "doc", targetId: pageId, body, parentId, anchor: null }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed to comment");
      }
      await fetchDocComments();
      return true;
    } catch (e) {
      setPostErr(e instanceof Error ? e.message : "Failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function mutateComment(id: string, method: "POST" | "DELETE", intent?: "resolve" | "reopen") {
    setBusy(true);
    setPostErr(null);
    try {
      const res = await fetch(`/api/comments/${id}`, {
        method,
        credentials: "include",
        headers: intent ? { "Content-Type": "application/json" } : undefined,
        body: intent ? JSON.stringify({ intent }) : undefined,
      });
      if (!res.ok) throw new Error("Failed");
      await fetchDocComments();
    } catch {
      setPostErr("Action failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const docRoots = docComments.filter((c) => c.parentId === null);
  const visibleDocRoots = docRoots.filter((c) =>
    filter === "resolved" ? c.resolved : !c.resolved,
  );

  return (
    <div
      className={
        // Inline: no card. It sits at the foot of the document as a continuation
        // of the page, separated by a rule rather than boxed in its own panel.
        inline
          ? "w-full flex flex-col border-t border-border pt-4"
          : "absolute right-0 top-full z-30 mt-1 w-[380px] rounded-md border border-border bg-card shadow-brand-2 flex flex-col"
      }
      style={inline ? undefined : { maxHeight: "60vh" }}
      aria-label="Comments panel"
    >
      {/* Header */}
      <div
        className={`flex items-center justify-between shrink-0 ${
          inline ? "pb-2" : "px-3 py-2 border-b border-border"
        }`}
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Comments</span>
        </div>
        {/* Open / Resolved filter pills */}
        <div className="flex rounded-md border border-border overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => handleFilterChange("open")}
            className={`px-2 py-1 ${filter === "open" ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-muted"}`}
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => handleFilterChange("resolved")}
            className={`px-2 py-1 border-l border-border ${filter === "resolved" ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-muted"}`}
          >
            Resolved
          </button>
        </div>
      </div>

      {fetchErr && (
        <div className={`py-2 text-xs text-destructive ${inline ? "" : "px-3"}`}>{fetchErr}</div>
      )}

      <div className={inline ? "" : "flex-1 overflow-y-auto min-h-0"}>
        {/* ── Inline threads section ───────────────────────────────────── */}
        {/* DocEditorImpl portals <ThreadsSidebar filter=… /> into this div
            when panelOpen is true. The div carries bn-root + bn-shadcn so
            BlockNote's component-tree styles apply without the full BlockNoteView
            wrapper duplicating in the DOM.

            Dropped from the inline variant: those threads are anchored to a
            passage and already render against it, so listing them again at the
            foot of the page shows the same comment twice. The foot panel is
            document-level comments only. */}
        {!inline && (
          <div className="px-3 pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              Inline
            </p>
            <div
              id={targetId}
              className="bn-root bn-shadcn"
              data-color-scheme="light"
            />
          </div>
        )}

        {/* ── Doc-level threads section ────────────────────────────────── */}
        <div className={inline ? "pb-3" : "px-3 pt-2 pb-3"}>
          {!inline && (
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              Document
            </p>
          )}

          {postErr && <p className="text-xs text-destructive mb-2">{postErr}</p>}

          {visibleDocRoots.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              {filter === "resolved" ? "No resolved comments." : "No comments yet."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visibleDocRoots.map((root) => {
                const replies = docComments.filter((c) => c.parentId === root.id);
                return (
                  <li
                    key={root.id}
                    className={`rounded-md border p-2 text-sm ${
                      root.resolved
                        ? "border-border bg-muted/40 opacity-70"
                        : "border-border bg-card"
                    }`}
                  >
                    {/* Root comment */}
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="flex items-center gap-1.5 text-xs font-medium">
                        <Avatar
                          photoUrl={root.authorPhotoUrl}
                          name={root.author}
                          size="xs"
                          className="shrink-0"
                        />
                        {root.author}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDate(root.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{root.body}</p>

                    {/* Replies */}
                    {replies.map((r) => (
                      <div key={r.id} className="ml-3 mt-1.5 pl-2 border-l border-border">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-xs font-medium">
                            <Avatar
                              photoUrl={r.authorPhotoUrl}
                              name={r.author}
                              size="xs"
                              className="shrink-0"
                            />
                            {r.author}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDate(r.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm text-foreground whitespace-pre-wrap mt-0.5">{r.body}</p>
                      </div>
                    ))}

                    {/* Actions */}
                    <div className="flex items-center gap-3 mt-1.5">
                      {replyTo === root.id ? (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (!replyDraft.trim()) return;
                            const ok = await postDocComment(replyDraft.trim(), root.id);
                            if (ok) { setReplyDraft(""); setReplyTo(null); }
                          }}
                          className="flex-1 flex items-end gap-1"
                        >
                          <MentionTextInput
                            autoFocus
                            value={replyDraft}
                            onChange={setReplyDraft}
                            placeholder="Reply…"
                            wrapperClassName="relative flex-1"
                            className="w-full px-2 py-1 text-xs border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-accent-teal/40"
                          />
                          <button
                            type="submit"
                            disabled={busy}
                            className="text-xs px-2 py-1 rounded bg-accent-teal text-white disabled:opacity-50"
                          >
                            Reply
                          </button>
                          <button
                            type="button"
                            onClick={() => setReplyTo(null)}
                            className="text-xs px-1 text-muted-foreground"
                          >
                            ✕
                          </button>
                        </form>
                      ) : (
                        <>
                          {canComment && (
                            <button
                              type="button"
                              onClick={() => setReplyTo(root.id)}
                              className="text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              Reply
                            </button>
                          )}
                          {canResolve && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                mutateComment(root.id, "POST", root.resolved ? "reopen" : "resolve")
                              }
                              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                            >
                              {root.resolved ? (
                                <><RotateCcw className="w-3 h-3" /> Reopen</>
                              ) : (
                                <><Check className="w-3 h-3" /> Resolve</>
                              )}
                            </button>
                          )}
                          {root.authorId === currentUserId && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => mutateComment(root.id, "DELETE")}
                              className="text-[11px] text-destructive hover:underline flex items-center gap-0.5"
                            >
                              <Trash2 className="w-3 h-3" /> Delete
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Doc-level composer */}
      {canComment && filter === "open" && (
        // Inline, the composer is part of the page flow, so it takes the same
        // full width as the header and the thread list above it. Only the
        // floating panel needs its own gutter.
        <div className={`border-t border-border py-2 shrink-0 ${inline ? "" : "px-3"}`}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              const ok = await postDocComment(draft.trim(), null);
              if (ok) setDraft("");
            }}
            className="flex flex-col gap-1"
          >
            <MentionTextInput
              multiline
              value={draft}
              onChange={setDraft}
              rows={2}
              placeholder="Add a document comment…"
              className="w-full px-2 py-1 text-xs border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-accent-teal/40"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="text-xs px-2 py-1 rounded bg-accent-teal text-white disabled:opacity-50"
              >
                Comment
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
