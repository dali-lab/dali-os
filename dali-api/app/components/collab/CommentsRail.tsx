import { useEffect, useRef, useState } from "react";
import { Check, Trash2, RotateCcw } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { CommentComposer } from "~/components/collab/CommentComposer";
import { type BodySegment, segmentsToPlainText } from "~/lib/comment-body";
import { RichCommentBody } from "~/components/doc/comments/RichCommentBody";

export type Comment = {
  id: string;
  parentId: string | null;
  author: string;
  authorId: string;
  authorPhotoUrl?: string | null;
  body: string;
  bodyJson?: BodySegment[] | null;
  /** Legacy Yjs anchor {from, to}, BlockNote inline marker {kind:"blocknote"},
   *  or null for doc/file-level threads. */
  anchor: { from: string; to: string } | { kind: "blocknote" } | null;
  resolved: boolean;
  createdAt: string;
  // File comments: the ProjectFileVersion current when the comment was
  // written. Null on doc/pagedoc comments and pre-pinning file comments.
  versionId?: string | null;
};

type Thread = { root: Comment; replies: Comment[] };

// Mutation callbacks for a single thread, handed to the host (via
// registerRefresh) so an inline popover anchored at the highlighted text can
// resolve/delete/reply without duplicating this rail's fetch + mutate logic.
export type ThreadActions = {
  resolve: (id: string, resolved: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reply: (parentId: string, body: string) => Promise<boolean>;
};

export function formatCommentDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// "V2" chip on file comments — which iteration the feedback was written on.
function VersionChip({
  comment,
  versionLabels,
}: {
  comment: Comment;
  versionLabels?: Record<string, string>;
}) {
  const label = comment.versionId ? versionLabels?.[comment.versionId] : undefined;
  if (!label) return null;
  return (
    <span className="mr-1.5 rounded bg-muted px-1 py-0.5 font-medium text-muted-foreground">
      {label}
    </span>
  );
}

// ── Inline-thread anchor helpers ────────────────────────────────────────────

/** True when the anchor is a legacy Yjs {from,to} pair. */
function isYjsAnchor(anchor: Comment["anchor"]): anchor is { from: string; to: string } {
  return (
    anchor !== null &&
    typeof anchor === "object" &&
    "from" in anchor &&
    "to" in anchor
  );
}

/** True when the anchor is a BlockNote inline mark {kind:"blocknote"}. */
function isBlockNoteAnchor(anchor: Comment["anchor"]): anchor is { kind: "blocknote" } {
  return (
    anchor !== null &&
    typeof anchor === "object" &&
    (anchor as { kind?: string }).kind === "blocknote"
  );
}

/** True when clicking this thread card can jump to its editor position. */
function isJumpable(
  root: Comment,
  onFocusAnchor?: (a: { from: string; to: string }) => void,
  onFocusInlineThread?: (id: string) => void,
): boolean {
  if (isYjsAnchor(root.anchor) && onFocusAnchor) return true;
  if (isBlockNoteAnchor(root.anchor) && onFocusInlineThread) return true;
  return false;
}

/** Dispatches the correct jump action based on anchor type. */
function handleJump(
  root: Comment,
  onFocusAnchor?: (a: { from: string; to: string }) => void,
  onFocusInlineThread?: (id: string) => void,
) {
  if (isYjsAnchor(root.anchor) && onFocusAnchor) {
    onFocusAnchor(root.anchor);
  } else if (isBlockNoteAnchor(root.anchor) && onFocusInlineThread) {
    onFocusInlineThread(root.id);
  }
}

// Comment threads for a document or file. Doc-level (anchor === null) and
// inline (anchor !== null) comments share this rail; the host passes
// `onFocusAnchor` (legacy Yjs anchors) or `onFocusInlineThread` (BlockNote
// inline marks) for inline ones so clicking a thread scrolls the editor to it.
// The rail owns its own data fetch + mutations so it can be dropped onto any
// doc/file surface.
export function CommentsRail({
  targetType,
  targetId,
  currentUserId,
  canComment,
  canResolve = true,
  // Inline-comment hooks. Provided only by the document editor.
  pendingAnchor,
  onClearPendingAnchor,
  onFocusAnchor,
  onFocusInlineThread,
  registerRefresh,
  mentionPath,
  focusCommentId,
  versionLabels,
  versionId,
}: {
  targetType: "doc" | "file" | "pagedoc";
  targetId: string;
  currentUserId: string;
  canComment: boolean;
  /** Whether this viewer may resolve/reopen threads. Defaults to true for
   * document/file hosts; page-doc FAQs restrict this to their maintainer. */
  canResolve?: boolean;
  pendingAnchor?: { from: string; to: string } | null;
  // For page-doc FAQ comments: the current page path, sent so @-mention
  // notifications can deep-link back to the guide (with ?doc=1).
  mentionPath?: string;
  // Arriving from a comment-mention notification (?comment=<id>): scroll to and
  // flash this comment once threads load.
  focusCommentId?: string;
  // File hosts: versionId → display label ("V2"), so feedback reads against
  // the iteration it was written on.
  versionLabels?: Record<string, string>;
  // File hosts: the version currently being previewed — new comments are
  // stamped with it rather than whatever version happens to be current.
  versionId?: string | null;
  onClearPendingAnchor?: () => void;
  /** Legacy Yjs-position anchor jump. Called for old inline comments that
   *  store a {from, to} Yjs relative position in the anchor column. */
  onFocusAnchor?: (anchor: { from: string; to: string }) => void;
  /** BlockNote inline thread jump. Called when the user clicks a thread whose
   *  anchor is {kind:"blocknote"}; scrolls to the [data-bn-thread-id] mark. */
  onFocusInlineThread?: (threadId: string) => void;
  // Lets the host trigger a refetch (e.g. after creating an inline comment
  // mark), receive the live thread list for decoration, and reuse this
  // rail's mutation logic (e.g. for an inline popover anchored at the
  // highlighted text).
  registerRefresh?: (refresh: () => void, threads: () => Comment[], actions: ThreadActions) => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Guards the auto-scroll so it fires once per target comment, not on every
  // refetch/re-render.
  const focusedRef = useRef<string | null>(null);

  async function refresh() {
    const res = await fetch(
      `/api/comments?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`,
      { credentials: "include" },
    );
    if (!res.ok) return;
    const b = (await res.json()) as { comments: Comment[] };
    setComments(b.comments);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetType, targetId]);

  useEffect(() => {
    registerRefresh?.(
      () => void refresh(),
      () => comments,
      {
        resolve: (id, resolved) => mutate(id, "POST", resolved ? "resolve" : "reopen"),
        remove: (id) => mutate(id, "DELETE"),
        reply: (parentId, body) => post(body, parentId, null),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments]);

  // Scroll to + flash the comment from a mention notification (?comment=<id>),
  // once. If it lives in a resolved thread, reveal resolved first.
  useEffect(() => {
    if (!focusCommentId || comments.length === 0) return;
    if (focusedRef.current === focusCommentId) return;
    const target = comments.find((c) => c.id === focusCommentId);
    if (!target) return; // not on this target's list
    focusedRef.current = focusCommentId;
    const rootId = target.parentId ?? target.id;
    const root = comments.find((c) => c.id === rootId);
    if (root?.resolved) setShowResolved(true);
    // Let the (possibly resolved-revealing) re-render commit before scrolling.
    setTimeout(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[data-comment-id="${focusCommentId}"]`,
      );
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("mention-flash");
      setTimeout(() => el.classList.remove("mention-flash"), 2600);
    }, 80);
  }, [focusCommentId, comments]);

  async function post(
    bodyOrSegments: string | BodySegment[],
    parentId: string | null,
    anchor: { from: string; to: string } | null,
  ) {
    setBusy(true);
    setError(null);
    // Accept both the legacy string form (used by registerRefresh callers) and
    // the new segment array form (from CommentComposer's onSubmit callback).
    const isSegments = Array.isArray(bodyOrSegments);
    const plainBody = isSegments ? segmentsToPlainText(bodyOrSegments) : bodyOrSegments;
    const bodyJson = isSegments ? bodyOrSegments : undefined;
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType,
          targetId,
          body: plainBody,
          ...(bodyJson !== undefined ? { bodyJson } : {}),
          parentId,
          anchor,
          path: mentionPath,
          versionId,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed to comment");
      }
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function mutate(id: string, method: "POST" | "DELETE", intent?: "resolve" | "reopen") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/comments/${id}`, {
        method,
        credentials: "include",
        headers: intent ? { "Content-Type": "application/json" } : undefined,
        body: intent ? JSON.stringify({ intent }) : undefined,
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed");
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const roots = comments.filter((c) => c.parentId === null);
  const threads: Thread[] = roots.map((root) => ({
    root,
    replies: comments.filter((c) => c.parentId === root.id),
  }));
  const visible = threads.filter((t) => showResolved || !t.root.resolved);
  const resolvedCount = threads.filter((t) => t.root.resolved).length;

  return (
    <div ref={containerRef} className="flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">Comments</h3>
        {resolvedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showResolved ? "Hide resolved" : `Show resolved (${resolvedCount})`}
          </button>
        )}
      </div>

      {error && <div className="text-xs text-destructive">{error}</div>}

      {/* Composer — anchored to the editor selection when the host has one
          waiting, otherwise a plain doc/file-level comment. */}
      {canComment && (
        <div className="flex flex-col gap-1">
          {pendingAnchor && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>Commenting on the selection</span>
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  onClearPendingAnchor?.();
                }}
                className="hover:text-foreground hover:underline"
              >
                Cancel
              </button>
            </div>
          )}
          <CommentComposer
            currentUserId={currentUserId}
            value={draft}
            onChange={setDraft}
            busy={busy}
            autoFocus={Boolean(pendingAnchor)}
            onCancel={
              pendingAnchor
                ? () => {
                    setDraft("");
                    onClearPendingAnchor?.();
                  }
                : undefined
            }
            onSubmit={async (segments) => {
              const ok = await post(segments, null, pendingAnchor ?? null);
              if (ok) {
                setDraft("");
                if (pendingAnchor) onClearPendingAnchor?.();
              }
            }}
          />
        </div>
      )}

      {visible.length > 0 && (
        <ul className="flex flex-col">
          {visible.map((t) => {
            const jumpable = isJumpable(t.root, onFocusAnchor, onFocusInlineThread);
            return (
              <li
                key={t.root.id}
                data-comment-id={t.root.id}
                className={`group border-b border-border/60 py-3 last:border-b-0 ${
                  t.root.resolved ? "opacity-60" : ""
                }`}
              >
                <button
                  type="button"
                  disabled={!jumpable}
                  onClick={() => handleJump(t.root, onFocusAnchor, onFocusInlineThread)}
                  className={`block w-full text-left ${jumpable ? "cursor-pointer" : "cursor-default"}`}
                >
                  <CommentHead comment={t.root} versionLabels={versionLabels} inline={Boolean(t.root.anchor)} />
                  <div className="mt-1 pl-7 leading-relaxed">
                    <RichCommentBody bodyJson={t.root.bodyJson} body={t.root.body} />
                  </div>
                </button>

                {t.replies.map((r) => (
                  <div key={r.id} data-comment-id={r.id} className="mt-3 pl-7">
                    <CommentHead comment={r} versionLabels={versionLabels} />
                    <div className="mt-1 pl-7 leading-relaxed">
                      <RichCommentBody bodyJson={r.bodyJson} body={r.body} />
                    </div>
                  </div>
                ))}

                {canComment && replyTo === t.root.id ? (
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
                        const ok = await post(segments, t.root.id, null);
                        if (ok) {
                          setReplyDraft("");
                          setReplyTo(null);
                        }
                      }}
                    />
                  </div>
                ) : (
                  // Actions stay out of the way until the thread is hovered or
                  // keyboard-focused, so the list reads as plain conversation.
                  <div className="mt-1.5 flex items-center gap-3 pl-7 text-[11px] opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    {canComment && (
                      <button
                        type="button"
                        onClick={() => setReplyTo(t.root.id)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        Reply
                      </button>
                    )}
                    {canComment && canResolve && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => mutate(t.root.id, "POST", t.root.resolved ? "reopen" : "resolve")}
                        className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
                      >
                        {t.root.resolved ? (
                          <><RotateCcw className="h-3 w-3" /> Reopen</>
                        ) : (
                          <><Check className="h-3 w-3" /> Resolve</>
                        )}
                      </button>
                    )}
                    {canComment && t.root.authorId === currentUserId && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => mutate(t.root.id, "DELETE")}
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
      )}
    </div>
  );
}

// Avatar + author + timestamp line shared by roots and replies.
function CommentHead({
  comment,
  versionLabels,
  inline = false,
}: {
  comment: Comment;
  versionLabels?: Record<string, string>;
  inline?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Avatar photoUrl={comment.authorPhotoUrl} name={comment.author} size="xs" className="shrink-0" />
      <span className="text-xs font-medium text-foreground">{comment.author}</span>
      <span className="text-[11px] text-muted-foreground">
        <VersionChip comment={comment} versionLabels={versionLabels} />
        {formatCommentDate(comment.createdAt)}
      </span>
      {inline && <span className="text-[11px] text-muted-foreground">· on selection</span>}
    </div>
  );
}
