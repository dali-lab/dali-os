import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { Trash2 } from "lucide-react";
import { cn } from "~/lib/cn";
import { relativeTime } from "~/lib/relative-time";
import { MentionText } from "~/components/MentionText";
import { MentionTextInput } from "~/components/MentionTextInput";
import { Avatar } from "~/components/ui/Avatar";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

export type PostComment = {
  id: string;
  body: string;
  createdAt: string;
  author: { name: string; photoUrl: string | null };
  canDelete: boolean;
};

/** The comment list and composer under a post. Posts `comment` and `delete-comment` intents. */
export function PostComments<C extends PostComment>({
  postId,
  comments,
  maxLength,
  avatarSize = "sm",
  fill = false,
  renderAuthor = (c) => <span className="font-semibold text-foreground">{c.author.name}</span>,
}: {
  postId: string;
  comments: C[];
  maxLength: number;
  avatarSize?: ComponentProps<typeof Avatar>["size"];
  /** Take the rest of a fixed-height panel: a count header and a list that scrolls. */
  fill?: boolean;
  renderAuthor?: (comment: C) => ReactNode;
}) {
  const fetcher = useFetcher<{ ok: boolean }>();
  const remove = useFetcher();
  const dialog = useDialog();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  // The submit's own result, handled once: fetcher.data persists afterwards.
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    if (!fetcher.data.ok) {
      toast.error("Could not post your comment");
      return;
    }
    setDraft("");
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [fetcher.state, fetcher.data, toast]);

  const busy = fetcher.state !== "idle";
  function send() {
    const body = draft.trim();
    if (!body || busy) return;
    fetcher.submit({ intent: "comment", postId, body }, { method: "post" });
  }

  async function onDelete(commentId: string) {
    const ok = await dialog.confirm({
      title: "Delete this comment?",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (ok) remove.submit({ intent: "delete-comment", commentId }, { method: "post" });
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-t border-os-container pt-4",
        fill && "min-h-0 flex-1",
      )}
    >
      {fill && (
        <p className="text-xs font-semibold uppercase tracking-widest text-os-grey">
          {comments.length === 0
            ? "Comments"
            : `${comments.length} ${comments.length === 1 ? "comment" : "comments"}`}
        </p>
      )}
      {(fill || comments.length > 0) && (
        <div
          ref={listRef}
          className={cn(
            "flex flex-col gap-3",
            fill && "-mx-1 min-h-0 flex-1 overflow-y-auto px-1",
          )}
        >
          {fill && comments.length === 0 && (
            <p className="text-sm text-os-muted">No comments yet.</p>
          )}
          {comments.map((c) => (
            <div key={c.id} className="group flex items-start gap-2.5">
              <Avatar size={avatarSize} name={c.author.name} photoUrl={c.author.photoUrl} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  {renderAuthor(c)}
                  <span className="text-xs text-os-grey" suppressHydrationWarning>
                    {relativeTime(c.createdAt)}
                  </span>
                </p>
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                  <MentionText text={c.body} />
                </p>
              </div>
              {c.canDelete && (
                <IconButton
                  label="Delete comment"
                  icon={Trash2}
                  tone="destructive"
                  className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100"
                  onClick={() => void onDelete(c.id)}
                />
              )}
            </div>
          ))}
        </div>
      )}
      <form
        className="os-form flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <MentionTextInput
          value={draft}
          onChange={setDraft}
          maxLength={maxLength}
          placeholder="Add a comment, @ to mention"
          ariaLabel="Add a comment"
          dropUp
          wrapperClassName="relative min-w-0 flex-1"
          className="w-full"
        />
        <Button type="submit" variant="secondary" disabled={busy || !draft.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
