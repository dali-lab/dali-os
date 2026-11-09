import { useEffect, useRef, useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { CommentComposer } from "~/components/collab/CommentComposer";
import { RichCommentBody } from "~/components/doc/comments/RichCommentBody";
import { segmentsToPlainText, type BodySegment } from "~/lib/comment-body";
import { groupSlideThreads, type SlideAnchor, type SlideComment, type SlideThread } from "~/lib/slide-comments";
import type { NewSlideComment } from "./useSlideComments";

export type CommentTarget = Omit<SlideAnchor, "kind">;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Head({ comment }: { comment: SlideComment }) {
  return (
    <div className="flex items-center gap-2">
      <Avatar photoUrl={comment.authorPhotoUrl} name={comment.author} size="xs" className="shrink-0" />
      <span className="text-xs font-medium text-foreground">{comment.author}</span>
      <time dateTime={comment.createdAt} className="text-[11px] text-muted-foreground">
        {new Date(comment.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
      </time>
    </div>
  );
}

function anchorLabel(thread: SlideThread): string | null {
  const a = thread.root.anchor as { elementId?: string } | null;
  if (thread.kind === "text") return a?.elementId ? `On text in ${a.elementId}` : "On text";
  if (thread.kind === "element") return `On ${a?.elementId}`;
  return null;
}

function ThreadCard({
  thread,
  viewerId,
  canComment,
  canModerate,
  focused,
  onOpen,
  onPost,
  onDelete,
}: {
  thread: SlideThread;
  viewerId: string;
  canComment: boolean;
  canModerate: boolean;
  focused: boolean;
  onOpen: () => void;
  onPost: (input: NewSlideComment) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [focused]);
  const label = anchorLabel(thread);
  const canDelete = (c: SlideComment) => c.authorId === viewerId || canModerate;
  const send = async (segments: BodySegment[]) => {
    setBusy(true);
    const ok = await onPost({ body: segmentsToPlainText(segments), bodyJson: segments, parentId: thread.root.id, anchor: null });
    setBusy(false);
    if (ok) (setDraft(""), setReplying(false));
  };
  return (
    <li
      ref={ref}
      data-thread-id={thread.root.id}
      data-focused={focused ? "true" : undefined}
      className={`group rounded-lg border px-3 py-2.5 text-sm ${focused ? "border-os-accent" : "border-border/60"}`}
    >
      <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`Open comment by ${thread.root.author}`}>
        {label && <span className="mb-1 block text-[11px] text-muted-foreground">{capitalize(label)}</span>}
        <Head comment={thread.root} />
        <div className="mt-1 pl-7"><RichCommentBody bodyJson={thread.root.bodyJson} body={thread.root.body} /></div>
      </button>
      {thread.replies.map((r) => (
        <div key={r.id} data-comment-id={r.id} className="mt-3 pl-7">
          <Head comment={r} />
          <div className="mt-1 pl-7"><RichCommentBody bodyJson={r.bodyJson} body={r.body} /></div>
          {canDelete(r) && (
            <button type="button" onClick={() => onDelete(r.id)} className="mt-1 flex items-center gap-0.5 pl-7 text-[11px] text-muted-foreground hover:text-destructive">
              <Trash2 className="h-3 w-3" aria-hidden /> Delete reply
            </button>
          )}
        </div>
      ))}
      {replying ? (
        <div className="mt-2 pl-7">
          <CommentComposer
            autoFocus
            currentUserId={viewerId}
            value={draft}
            onChange={setDraft}
            busy={busy}
            placeholder="Reply…"
            submitLabel="Post reply"
            onCancel={() => (setDraft(""), setReplying(false))}
            onSubmit={send}
          />
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-3 pl-7 text-[11px]">
          {canComment && (
            <button type="button" onClick={() => setReplying(true)} className="text-muted-foreground hover:text-foreground">
              Reply
            </button>
          )}
          {canDelete(thread.root) && (
            <button type="button" onClick={() => onDelete(thread.root.id)} className="flex items-center gap-0.5 text-muted-foreground hover:text-destructive">
              <Trash2 className="h-3 w-3" aria-hidden /> Delete
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function SlideCommentsPanel({
  comments,
  error,
  viewerId,
  canComment,
  canModerate,
  slideIds,
  deletedIds,
  currentSlideId,
  canRestore,
  target,
  focusThreadId,
  onClearTarget,
  onPost,
  onDelete,
  onOpenThread,
  onRestoreSlide,
  onClose,
}: {
  comments: SlideComment[];
  error: string | null;
  viewerId: string;
  canComment: boolean;
  canModerate: boolean;
  slideIds: string[];
  deletedIds: string[];
  currentSlideId: string | null;
  canRestore: boolean;
  target: CommentTarget | null;
  focusThreadId: string | null;
  onClearTarget: () => void;
  onPost: (input: NewSlideComment) => Promise<boolean>;
  onDelete: (id: string) => void;
  onOpenThread: (thread: SlideThread) => void;
  onRestoreSlide: (slideId: string) => void;
  onClose: () => void;
}) {
  const dialog = useDialog();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const groups = groupSlideThreads(comments, slideIds);
  const total = groups.reduce((n, g) => n + g.threads.length, 0);
  const composeSlideId = target?.slideId ?? currentSlideId;
  const composeIndex = composeSlideId ? slideIds.indexOf(composeSlideId) : -1;
  const composeLabel = composeIndex >= 0 ? `Slide ${composeIndex + 1}${target?.elementId ? `, ${target.elementId}` : ""}` : "the deck";

  const submit = async (segments: BodySegment[]) => {
    setBusy(true);
    const anchor = composeSlideId && composeIndex >= 0 ? { kind: "slide", ...(target ?? { slideId: composeSlideId }), slideId: composeSlideId } : null;
    const ok = await onPost({ body: segmentsToPlainText(segments), bodyJson: segments, parentId: null, anchor });
    setBusy(false);
    if (ok) (setDraft(""), onClearTarget());
  };

  const confirmDelete = async (id: string) => {
    const ok = await dialog.confirm({
      title: "Delete this comment?",
      description: "Its replies go with it, for everyone. This can't be undone.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (ok) onDelete(id);
  };

  return (
    <aside aria-label="Comments" className="flex min-h-0 w-80 shrink-0 flex-col border-l border-os-container">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <h2 className="text-xs font-medium text-muted-foreground">
          Comments{total > 0 && <span className="ml-1.5">{total}</span>}
        </h2>
        <IconButton label="Close comments" icon={X} onClick={onClose} />
      </div>
      {error && <p className="px-3 pb-1 text-xs text-destructive">{error}</p>}
      {canComment && (
        <div className="shrink-0 px-3 pb-2">
          <p className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Comment on {composeLabel}</span>
            {target && (
              <button type="button" onClick={onClearTarget} className="hover:text-foreground">
                Cancel
              </button>
            )}
          </p>
          <CommentComposer
            autoFocus={target !== null}
            currentUserId={viewerId}
            value={draft}
            onChange={setDraft}
            busy={busy}
            onSubmit={submit}
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {total === 0 && <p className="py-4 text-sm text-muted-foreground">No comments on this deck yet.</p>}
        {groups.map((group) => (
          <section key={group.slideId ?? "deck"} aria-label={group.deleted ? "Deleted slide" : group.number ? `Slide ${group.number}` : "Deck"} className="mt-3">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{group.deleted ? "Deleted slide" : group.number ? `Slide ${group.number}` : "Deck"}</span>
              {group.deleted && canRestore && group.slideId && deletedIds.includes(group.slideId) && (
                <button type="button" onClick={() => onRestoreSlide(group.slideId!)} className="flex items-center gap-1 hover:text-foreground">
                  <RotateCcw className="h-3 w-3" aria-hidden /> Restore
                </button>
              )}
            </div>
            <ul className="flex flex-col gap-2">
              {group.threads.map((thread) => (
                <ThreadCard
                  key={thread.root.id}
                  thread={thread}
                  viewerId={viewerId}
                  canComment={canComment}
                  canModerate={canModerate}
                  focused={focusThreadId === thread.root.id}
                  onOpen={() => onOpenThread(thread)}
                  onPost={onPost}
                  onDelete={confirmDelete}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
