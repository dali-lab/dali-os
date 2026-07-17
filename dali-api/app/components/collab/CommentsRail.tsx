import { useEffect, useState } from "react";
import { Check, Trash2, RotateCcw, MessageSquare } from "lucide-react";

export type Comment = {
  id: string;
  parentId: string | null;
  author: string;
  authorId: string;
  body: string;
  anchor: { from: string; to: string } | null;
  resolved: boolean;
  createdAt: string;
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

// Comment threads for a document or file. Doc-level (anchor === null) and
// inline (anchor !== null) comments share this rail; the host passes
// `onFocusAnchor` for inline ones so clicking a thread scrolls the editor to
// its range. The rail owns its own data fetch + mutations so it can be dropped
// onto any doc/file surface.
export function CommentsRail({
  targetType,
  targetId,
  currentUserId,
  canComment,
  // Inline-comment hooks. Provided only by the document editor.
  pendingAnchor,
  onClearPendingAnchor,
  onFocusAnchor,
  registerRefresh,
}: {
  targetType: "doc" | "file";
  targetId: string;
  currentUserId: string;
  canComment: boolean;
  pendingAnchor?: { from: string; to: string } | null;
  onClearPendingAnchor?: () => void;
  onFocusAnchor?: (anchor: { from: string; to: string }) => void;
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

  async function post(body: string, parentId: string | null, anchor: { from: string; to: string } | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, body, parentId, anchor }),
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
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4" /> Comments
        </h3>
        {resolvedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showResolved ? "Hide resolved" : `Show resolved (${resolvedCount})`}
          </button>
        )}
      </div>

      {error && <div className="text-xs text-destructive">{error}</div>}

      {/* New inline comment composer — appears when the editor has a pending
          selection anchor awaiting a comment. */}
      {canComment && pendingAnchor && (
        <div className="rounded-md border border-accent-coral/40 bg-accent-coral/5 p-2">
          <p className="text-[11px] text-muted-foreground mb-1">Comment on selection</p>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="w-full px-2 py-1 text-sm border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-accent-coral/40"
          />
          <div className="flex justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={() => {
                setDraft("");
                onClearPendingAnchor?.();
              }}
              className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !draft.trim()}
              onClick={async () => {
                const ok = await post(draft.trim(), null, pendingAnchor);
                if (ok) {
                  setDraft("");
                  onClearPendingAnchor?.();
                }
              }}
              className="text-xs px-2 py-1 rounded bg-accent-coral text-white disabled:opacity-50"
            >
              Comment
            </button>
          </div>
        </div>
      )}

      {/* Doc/file-level composer (no anchor). */}
      {canComment && !pendingAnchor && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            const ok = await post(draft.trim(), null, null);
            if (ok) setDraft("");
          }}
          className="flex flex-col gap-1"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="Add a comment…"
            className="w-full px-2 py-1 text-sm border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-accent-coral/40"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="text-xs px-2 py-1 rounded bg-accent-coral text-white disabled:opacity-50"
            >
              Comment
            </button>
          </div>
        </form>
      )}

      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No comments yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((t) => (
            <li
              key={t.root.id}
              className={`rounded-md border p-2 ${
                t.root.resolved ? "border-border bg-muted/40 opacity-70" : "border-border bg-card"
              }`}
            >
              <button
                type="button"
                disabled={!t.root.anchor || !onFocusAnchor}
                onClick={() => t.root.anchor && onFocusAnchor?.(t.root.anchor)}
                className={`block w-full text-left ${t.root.anchor && onFocusAnchor ? "hover:bg-muted/50 rounded" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">{t.root.author}</span>
                  <span className="text-[10px] text-muted-foreground">{formatCommentDate(t.root.createdAt)}</span>
                </div>
                {t.root.anchor && (
                  <span className="text-[10px] text-accent-coral">inline</span>
                )}
                <p className="text-sm text-foreground whitespace-pre-wrap mt-0.5">{t.root.body}</p>
              </button>

              {t.replies.map((r) => (
                <div key={r.id} className="ml-3 mt-1.5 pl-2 border-l border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">{r.author}</span>
                    <span className="text-[10px] text-muted-foreground">{formatCommentDate(r.createdAt)}</span>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap mt-0.5">{r.body}</p>
                </div>
              ))}

              {canComment && (
                <div className="flex items-center gap-3 mt-1.5">
                  {replyTo === t.root.id ? (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!replyDraft.trim()) return;
                        const ok = await post(replyDraft.trim(), t.root.id, null);
                        if (ok) {
                          setReplyDraft("");
                          setReplyTo(null);
                        }
                      }}
                      className="flex-1 flex items-end gap-1"
                    >
                      <input
                        autoFocus
                        value={replyDraft}
                        onChange={(e) => setReplyDraft(e.target.value)}
                        placeholder="Reply…"
                        className="flex-1 px-2 py-1 text-xs border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-accent-coral/40"
                      />
                      <button type="submit" disabled={busy} className="text-xs px-2 py-1 rounded bg-accent-coral text-white disabled:opacity-50">
                        Reply
                      </button>
                      <button type="button" onClick={() => setReplyTo(null)} className="text-xs px-1 text-muted-foreground">
                        ✕
                      </button>
                    </form>
                  ) : (
                    <>
                      <button type="button" onClick={() => setReplyTo(t.root.id)} className="text-[11px] text-muted-foreground hover:text-foreground">
                        Reply
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => mutate(t.root.id, "POST", t.root.resolved ? "reopen" : "resolve")}
                        className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                      >
                        {t.root.resolved ? <><RotateCcw className="w-3 h-3" /> Reopen</> : <><Check className="w-3 h-3" /> Resolve</>}
                      </button>
                      {t.root.authorId === currentUserId && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => mutate(t.root.id, "DELETE")}
                          className="text-[11px] text-destructive hover:underline flex items-center gap-0.5"
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
