import { useState } from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { IconButton } from "~/components/ui/IconButton";
import { ToggleChip } from "~/components/ui/ToggleChip";
import { Menu } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { ReactionBar } from "~/components/ReactionBar";
import { CommentComposer } from "~/components/collab/CommentComposer";
import { RichCommentBody } from "~/components/doc/comments/RichCommentBody";
import type { SlideCommentsApi } from "~/components/slides/collab/useSlideComments";
import { segmentsToPlainText, type BodySegment } from "~/lib/comment-body";
import { FEEDBACK_EMOJI } from "~/lib/feedback";
import { relativeTime } from "~/lib/relative-time";
import type { SlideComment } from "~/lib/slide-comments";
import { cn } from "~/lib/cn";
import { reactionSummaries, wasEdited, type CritThread } from "./threads";

export type CritApi = Pick<SlideCommentsApi, "post" | "edit" | "react" | "remove">;

interface Viewer {
  id: string;
  canModerate: boolean;
}

function CommentItem({ comment, isRoot, viewer, api }: { comment: SlideComment; isRoot: boolean; viewer: Viewer; api: CritApi }) {
  const dialog = useDialog();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const canEdit = comment.authorId === viewer.id;
  const canDelete = canEdit || viewer.canModerate;
  const reactions = reactionSummaries(comment, viewer.id);

  const save = async (segments: BodySegment[]) => {
    setBusy(true);
    const ok = await api.edit(comment.id, segmentsToPlainText(segments), segments);
    setBusy(false);
    if (ok) setEditing(false);
  };
  const remove = async () => {
    const ok = await dialog.confirm({
      title: "Delete this comment?",
      description: isRoot ? "Its replies go too." : undefined,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (ok) await api.remove(comment.id);
  };

  return (
    <div data-comment-id={comment.id} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Avatar name={comment.author} photoUrl={comment.authorPhotoUrl} size="xs" className="shrink-0" />
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{comment.author}</span>
        <time dateTime={comment.createdAt} className="shrink-0 text-xs text-muted-foreground">
          {relativeTime(comment.createdAt)}
          {wasEdited(comment) && " (edited)"}
        </time>
        {(canEdit || canDelete) && !editing && (
          <div className="ml-auto">
            <Menu align="right" ariaLabel="Comment actions" trigger={<IconButton label="More actions" icon={MoreHorizontal} iconClassName="size-4" />}>
              {canEdit && (
                <Menu.Item icon={<Pencil className="h-3.5 w-3.5" />} onSelect={() => (setDraft(comment.body), setEditing(true))}>
                  Edit
                </Menu.Item>
              )}
              {canDelete && (
                <Menu.Item destructive icon={<Trash2 className="h-3.5 w-3.5" />} onSelect={() => void remove()}>
                  Delete
                </Menu.Item>
              )}
            </Menu>
          </div>
        )}
      </div>
      {editing ? (
        <CommentComposer autoFocus currentUserId={viewer.id} value={draft} onChange={setDraft} busy={busy} submitLabel="Save" onCancel={() => setEditing(false)} onSubmit={save} />
      ) : (
        <>
          <RichCommentBody bodyJson={comment.bodyJson} body={comment.body} className="text-sm [overflow-wrap:anywhere]" />
          <ReactionBar
            reactions={reactions}
            palette={FEEDBACK_EMOJI}
            onReact={(emoji) => void api.react(comment.id, emoji, !reactions.find((r) => r.emoji === emoji)?.mine)}
          />
        </>
      )}
    </div>
  );
}

export function ThreadView({
  thread,
  viewer,
  api,
  step,
}: {
  thread: CritThread;
  viewer: Viewer;
  api: CritApi;
  step?: { index: number; total: number; onPrev: () => void; onNext: () => void };
}) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (segments: BodySegment[]) => {
    setBusy(true);
    const ok = await api.post({ body: segmentsToPlainText(segments), bodyJson: segments, parentId: thread.root.id, anchor: null });
    setBusy(false);
    if (ok) setReply("");
  };
  return (
    <div className="flex flex-col gap-3" data-thread-view={thread.root.id}>
      {step && step.total > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {step.index + 1} of {step.total}
          </span>
          <span className="flex items-center gap-0.5">
            <IconButton label="Previous comment" icon={ChevronLeft} onClick={step.onPrev} />
            <IconButton label="Next comment" icon={ChevronRight} onClick={step.onNext} />
          </span>
        </div>
      )}
      <CommentItem comment={thread.root} isRoot viewer={viewer} api={api} />
      {thread.replies.map((r) => (
        <div key={r.id} className="border-l border-os-container pl-3">
          <CommentItem comment={r} isRoot={false} viewer={viewer} api={api} />
        </div>
      ))}
      <CommentComposer currentUserId={viewer.id} value={reply} onChange={setReply} busy={busy} placeholder="Reply" submitLabel="Reply" onSubmit={send} />
    </div>
  );
}

export function CritPanel({
  question,
  editForm,
  threads,
  allCount,
  total,
  loaded,
  error,
  viewer,
  api,
  isImage,
  wide,
  activeId,
  mineOnly,
  onMineChange,
  onOpen,
  onHide,
  draftComposer,
}: {
  question: string | null;
  editForm: React.ReactNode;
  threads: CritThread[];
  allCount: number;
  total: number;
  loaded: boolean;
  error: string | null;
  viewer: Viewer;
  api: CritApi;
  isImage: boolean;
  wide: boolean;
  activeId: string | null;
  mineOnly: boolean;
  onMineChange: (on: boolean) => void;
  onOpen: (threadId: string) => void;
  onHide: () => void;
  draftComposer: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (segments: BodySegment[]) => {
    setBusy(true);
    const ok = await api.post({ body: segmentsToPlainText(segments), bodyJson: segments, parentId: null, anchor: null });
    setBusy(false);
    if (ok) setText("");
  };
  const empty = !isImage ? "No comments yet." : wide ? "No comments yet. Press C, then click the image to leave one." : "No comments yet. Switch to Comment, then tap the image to leave one.";

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {editForm ?? (question && <p className="rounded-lg bg-os-bg px-3 py-2 text-sm text-foreground [overflow-wrap:anywhere]">{question}</p>)}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          Comments <span className="text-muted-foreground">{total}</span>
        </h3>
        <ToggleChip on={mineOnly} onToggle={() => onMineChange(!mineOnly)}>
          Mine
        </ToggleChip>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!loaded && !error && <p className="text-sm text-os-grey">Loading comments…</p>}
      {loaded && allCount === 0 && <p className="text-sm text-os-grey">{empty}</p>}
      {loaded && allCount > 0 && threads.length === 0 && <p className="text-sm text-os-grey">You haven't commented yet.</p>}
      <ul className="flex flex-col gap-1">
        {threads.map((t) => {
          const open = activeId === t.root.id;
          const inline = open && (!wide || !t.pin);
          return (
            <li key={t.root.id} data-thread-row={t.root.id} className={cn("rounded-xl px-2 py-2 transition-colors duration-150", open ? "bg-os-accent/10" : "hover:bg-os-hover")}>
              {inline ? (
                <div className="flex flex-col gap-2">
                  <ThreadView thread={t} viewer={viewer} api={api} />
                  <button type="button" onClick={onHide} className="w-fit text-xs text-muted-foreground hover:text-foreground">
                    Hide thread
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => onOpen(t.root.id)} aria-expanded={open} className="flex w-full flex-col gap-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/60">
                  <span className="flex items-center gap-2">
                    <Avatar name={t.root.author} photoUrl={t.root.authorPhotoUrl} size="xs" className="shrink-0" />
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{t.root.author}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(t.root.createdAt)}</span>
                  </span>
                  <RichCommentBody bodyJson={t.root.bodyJson} body={t.root.body} className="line-clamp-2 text-sm [overflow-wrap:anywhere]" />
                  {t.replies.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {t.replies.length} {t.replies.length === 1 ? "reply" : "replies"}
                    </span>
                  )}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {draftComposer}
      <div className="border-t border-os-container pt-2">
        <CommentComposer currentUserId={viewer.id} value={text} onChange={setText} busy={busy} placeholder="Add a comment" submitLabel="Post" onSubmit={send} />
      </div>
    </div>
  );
}
