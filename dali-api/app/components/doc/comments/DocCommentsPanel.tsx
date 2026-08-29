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
import { Check, RotateCcw, Trash2 } from "lucide-react";

import { Avatar } from "~/components/ui/Avatar";
import { CommentComposer } from "~/components/collab/CommentComposer";
import { type BodySegment, segmentsToPlainText } from "~/lib/comment-body";
import { DaliThreadStore, getOrCreateStore } from "./DaliThreadStore";
import { RichCommentBody } from "./RichCommentBody";

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
  bodyJson?: BodySegment[] | null;
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

  async function postDocComment(
    segments: BodySegment[],
    parentId: string | null,
  ) {
    setBusy(true);
    setPostErr(null);
    const plainBody = segmentsToPlainText(segments);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "doc",
          targetId: pageId,
          body: plainBody,
          bodyJson: segments,
          parentId,
          anchor: null,
        }),
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
  const openCount = docRoots.filter((c) => !c.resolved).length;

  const filterToggle = (
    <div className="flex items-center gap-3 text-[11px]">
      {(["open", "resolved"] as const).map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => handleFilterChange(f)}
          className={
            filter === f
              ? "font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }
        >
          {f === "open" ? `Open${openCount > 0 ? ` (${openCount})` : ""}` : "Resolved"}
        </button>
      ))}
    </div>
  );

  return (
    <div
      className={
        inline
          ? "w-full flex flex-col p-4"
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
        <h3 className="text-xs font-medium text-muted-foreground">Comments</h3>
        {filterToggle}
      </div>

      {fetchErr && (
        <div className={`py-2 text-xs text-destructive ${inline ? "" : "px-3"}`}>{fetchErr}</div>
      )}

      {postErr && (
        <p className={`pb-1 text-xs text-destructive ${inline ? "" : "px-3"}`}>{postErr}</p>
      )}

      {/* Composer sits right under the header, the same place it does on every
          other comment surface. */}
      {canComment && filter === "open" && (
        <div className={`shrink-0 ${inline ? "" : "px-3 pt-1 pb-2"}`}>
          <CommentComposer
            currentUserId={currentUserId}
            value={draft}
            onChange={setDraft}
            busy={busy}
            onSubmit={async (segments) => {
              const ok = await postDocComment(segments, null);
              if (ok) setDraft("");
            }}
          />
        </div>
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
          <div className="px-3">
            <p className="mb-1.5 text-[11px] text-muted-foreground">Inline</p>
            <div
              id={targetId}
              className="bn-root bn-shadcn"
              data-color-scheme="light"
            />
          </div>
        )}

        {/* ── Doc-level threads section ────────────────────────────────── */}
        {visibleDocRoots.length > 0 && (
          <div className={inline ? "" : "px-3 pb-3"}>
            {!inline && (
              <p className="mb-1.5 mt-3 text-[11px] text-muted-foreground">Document</p>
            )}
            <ul className="flex flex-col">
              {visibleDocRoots.map((root) => {
                const replies = docComments.filter((c) => c.parentId === root.id);
                return (
                  <li
                    key={root.id}
                    data-comment-id={root.id}
                    className={`group border-b border-border/60 py-3 text-sm last:border-b-0 ${
                      root.resolved ? "opacity-60" : ""
                    }`}
                  >
                    <CommentHead comment={root} />
                    <div className="mt-1 pl-7 leading-relaxed text-foreground">
                      <RichCommentBody bodyJson={root.bodyJson} body={root.body} />
                    </div>

                    {replies.map((r) => (
                      <div key={r.id} data-comment-id={r.id} className="mt-3 pl-7">
                        <CommentHead comment={r} />
                        <div className="mt-1 pl-7 leading-relaxed text-foreground">
                          <RichCommentBody bodyJson={r.bodyJson} body={r.body} />
                        </div>
                      </div>
                    ))}

                    {canComment && replyTo === root.id ? (
                      <div className="mt-2 pl-7">
                        <CommentComposer
                          autoFocus
                          currentUserId={currentUserId}
                          value={replyDraft}
                          onChange={setReplyDraft}
                          busy={busy}
                          placeholder="Reply…"
                          submitLabel="Post reply"
                          onCancel={() => {
                            setReplyDraft("");
                            setReplyTo(null);
                          }}
                          onSubmit={async (segments) => {
                            const ok = await postDocComment(segments, root.id);
                            if (ok) {
                              setReplyDraft("");
                              setReplyTo(null);
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <div className="mt-1.5 flex items-center gap-3 pl-7 text-[11px] opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        {canComment && (
                          <button
                            type="button"
                            onClick={() => setReplyTo(root.id)}
                            className="text-muted-foreground hover:text-foreground"
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
                            className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
                          >
                            {root.resolved ? (
                              <><RotateCcw className="h-3 w-3" /> Reopen</>
                            ) : (
                              <><Check className="h-3 w-3" /> Resolve</>
                            )}
                          </button>
                        )}
                        {root.authorId === currentUserId && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => mutateComment(root.id, "DELETE")}
                            className="flex items-center gap-0.5 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// Avatar + author + timestamp line shared by roots and replies.
function CommentHead({ comment }: { comment: ApiComment }) {
  return (
    <div className="flex items-center gap-2">
      <Avatar
        photoUrl={comment.authorPhotoUrl}
        name={comment.author}
        size="xs"
        className="shrink-0"
      />
      <span className="text-xs font-medium text-foreground">{comment.author}</span>
      <span className="text-[11px] text-muted-foreground">{formatDate(comment.createdAt)}</span>
    </div>
  );
}
