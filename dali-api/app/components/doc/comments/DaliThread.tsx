import { useEffect, useState, type FocusEvent } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { BlockNoteEditor } from "@blocknote/core";
import { CommentsExtension, type CommentData, type ThreadData } from "@blocknote/core/comments";
import { useComponentsContext, useCreateBlockNote, useDictionary, useEditorState, useExtension } from "@blocknote/react";
import { Avatar } from "~/components/ui/Avatar";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Menu } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { ReactionBar, ReactionPicker } from "~/components/ReactionBar";
import { FEEDBACK_EMOJI } from "~/lib/feedback";
import type { DaliThreadStore } from "./DaliThreadStore";
import { commentReactionSummaries, type CommentMeta } from "./comment-reactions";

export type DaliThreadProps = {
  thread: ThreadData;
  selected?: boolean;
  orphaned?: boolean;
  maxCommentsBeforeCollapse?: number;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  tabIndex?: number;
  newCommentEditor?: BlockNoteEditor<any, any, any>;
};

function useStore() {
  const comments = useExtension(CommentsExtension);
  return { comments, store: comments.threadStore as DaliThreadStore };
}

function CommentBody({
  comment,
  threadId,
  editing,
  onDone,
}: {
  comment: CommentData;
  threadId: string;
  editing: boolean;
  onDone: () => void;
}) {
  const Components = useComponentsContext()!;
  const { comments, store } = useStore();
  const editor = useCreateBlockNote({
    initialContent: comment.body,
    trailingBlock: false,
    schema: comments.commentEditorSchema,
  });
  const empty = useEditorState({ editor, selector: ({ editor: e }) => e.isEmpty });
  useEffect(() => {
    if (editing) editor.focus();
  }, [editing, editor]);

  async function save() {
    await store.updateComment({ commentId: comment.id, threadId, comment: { body: editor.document } });
    onDone();
  }
  function cancel() {
    editor.replaceBlocks(editor.document, comment.body);
    onDone();
  }

  return (
    <>
      <Components.Comments.Editor
        className="bn-comment-editor"
        editor={editor}
        editable={editing}
        autoFocus={editing}
        onFocus={() => {}}
        onBlur={() => {}}
      />
      {editing && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void save()} disabled={empty}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        </div>
      )}
    </>
  );
}

export function DaliComment({ comment, thread, isRoot }: { comment: CommentData; thread: ThreadData; isRoot: boolean }) {
  const { store } = useStore();
  const dialog = useDialog();
  const [editing, setEditing] = useState(false);
  const meta = (comment.metadata ?? {}) as CommentMeta;
  const reactions = commentReactionSummaries(comment, store.viewerId);
  const canEdit = store.auth.canUpdateComment(comment);
  const canDelete = isRoot ? store.auth.canDeleteThread(thread) || store.auth.canDeleteComment(comment) : store.auth.canDeleteComment(comment);

  function react(emoji: string) {
    const mine = reactions.find((r) => r.emoji === emoji)?.mine;
    const args = { threadId: thread.id, commentId: comment.id, emoji };
    void (mine ? store.deleteReaction(args) : store.addReaction(args));
  }

  async function remove() {
    const ok = await dialog.confirm({
      title: "Delete this comment?",
      description: isRoot && thread.comments.length > 1 ? "Its replies go with it, for everyone." : undefined,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    await (isRoot ? store.deleteThread({ threadId: thread.id }) : store.deleteComment({ threadId: thread.id, commentId: comment.id }));
  }

  return (
    <div className="bn-thread-comment group/comment relative flex flex-col gap-1.5" data-comment-id={comment.id}>
      {!editing && (
        <div className="dali-comment-actions absolute right-0 top-0 z-10 flex items-center gap-0.5 rounded-full bg-os-card opacity-0 transition-opacity focus-within:opacity-100 group-hover/comment:opacity-100 has-[[aria-expanded=true]]:opacity-100 touch:opacity-100">
          {reactions.length === 0 && <ReactionPicker palette={FEEDBACK_EMOJI} onReact={react} />}
          {(canEdit || canDelete) && (
            <Menu
              align="right"
              ariaLabel="Comment actions"
              trigger={<IconButton label="More actions" icon={MoreHorizontal} iconClassName="size-4" />}
            >
              {canEdit && (
                <Menu.Item icon={<Pencil className="h-3.5 w-3.5" />} onSelect={() => setEditing(true)}>
                  Edit
                </Menu.Item>
              )}
              {canDelete && (
                <Menu.Item destructive icon={<Trash2 className="h-3.5 w-3.5" />} onSelect={() => void remove()}>
                  Delete
                </Menu.Item>
              )}
            </Menu>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 pr-16">
        <Avatar size="sm" name={meta.author ?? ""} photoUrl={meta.authorPhotoUrl ?? null} />
        <span className="truncate text-sm font-semibold text-foreground">{meta.author ?? "Unknown"}</span>
        <span className="shrink-0 text-xs text-os-grey">
          {comment.createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      </div>
      <CommentBody key={JSON.stringify(comment.body)} comment={comment} threadId={thread.id} editing={editing} onDone={() => setEditing(false)} />
      {reactions.length > 0 && !editing && (
        <ReactionBar reactions={reactions} palette={FEEDBACK_EMOJI} onReact={react} />
      )}
    </div>
  );
}

function ReplyComposer({ thread, editor }: { thread: ThreadData; editor: BlockNoteEditor<any, any, any> }) {
  const Components = useComponentsContext()!;
  const { store } = useStore();
  const empty = useEditorState({ editor, selector: ({ editor: e }) => e.isEmpty });
  async function save() {
    await store.addComment({ threadId: thread.id, comment: { body: editor.document } });
    editor.removeBlocks(editor.document);
  }
  return (
    <>
      <Components.Comments.Editor
        className="bn-comment-editor"
        editor={editor}
        editable
        autoFocus={false}
        onFocus={() => {}}
        onBlur={() => {}}
      />
      {!empty && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void save()}>
            Save
          </Button>
        </div>
      )}
    </>
  );
}

/** A thread card: BlockNote's card shell around our own comments, reactions and reply box. */
export function DaliThread({
  thread,
  selected,
  orphaned,
  maxCommentsBeforeCollapse,
  onFocus,
  onBlur,
  tabIndex,
  newCommentEditor,
}: DaliThreadProps) {
  const Components = useComponentsContext()!;
  const { comments } = useStore();
  const dict = useDictionary();
  const ownEditor = useCreateBlockNote({
    trailingBlock: false,
    schema: comments.commentEditorSchema,
    dictionary: { ...dict, placeholders: { ...dict.placeholders, emptyDocument: dict.placeholders.comment_reply } },
  });
  const replyEditor = newCommentEditor ?? ownEditor;
  const limit = selected ? undefined : (maxCommentsBeforeCollapse ?? 5);
  const list = thread.comments;
  const collapsed = limit !== undefined && list.length > limit;
  const shown = collapsed ? [list[0], list[list.length - 1]] : list;

  return (
    <Components.Comments.Card
      className={orphaned ? "bn-thread bn-thread-orphaned" : "bn-thread"}
      selected={selected}
      onFocus={onFocus}
      onBlur={onBlur}
      tabIndex={tabIndex}
    >
      <Components.Comments.CardSection className="bn-thread-comments">
        {shown.map((c, i) => (
          <div key={c.id} className="contents">
            <DaliComment comment={c} thread={thread} isRoot={c.id === list[0].id} />
            {collapsed && i === 0 && (
              <p className="bn-thread-expand-prompt text-xs text-os-grey">
                {list.length - 2} more {list.length - 2 === 1 ? "reply" : "replies"}
              </p>
            )}
          </div>
        ))}
      </Components.Comments.CardSection>
      {selected && (
        <Components.Comments.CardSection className="bn-thread-composer">
          <ReplyComposer thread={thread} editor={replyEditor} />
        </Components.Comments.CardSection>
      )}
    </Components.Comments.Card>
  );
}

