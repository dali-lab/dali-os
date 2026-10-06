import { useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { Archive, ChevronDown, Lock, MailOpen, Paperclip, Reply, Trash2 } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { MentionTextInput } from "~/components/MentionTextInput";
import { MailBody } from "~/email/components/MailBody";
import { ApplicantLinkSection } from "~/email/components/ApplicantLinkSection";
import { Composer, type RecipientDirectory } from "~/email/components/Composer";
import { cn } from "~/lib/cn";
import { formatBytes } from "~/lib/upload-client";
import { senderAddress, senderName, shortDate } from "~/email/lib/format";
import type { EmailPageData } from "~/email/lib/email.server";

type Loaded = Extract<NonNullable<EmailPageData["selected"]>, { error: false }>;

export function ThreadView({
  thread,
  accounts,
  drafts,
  aiEnabled,
  directory,
  expandButton,
  onClose,
}: {
  thread: Loaded;
  accounts: EmailPageData["accounts"];
  drafts: EmailPageData["drafts"];
  aiEnabled: boolean;
  directory: RecipientDirectory;
  expandButton: ReactNode;
  onClose: () => void;
}) {
  const actions = useFetcher();
  const commentFetcher = useFetcher();
  const dialog = useDialog();
  const [replying, setReplying] = useState(false);
  const [comment, setComment] = useState("");
  // Messages whose open state the reader flipped from the default (only the
  // newest message starts open).
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const { accountId, threadId, messages, comments } = thread;
  const account = accounts.find((a) => a.id === accountId);
  const threadDraft = drafts.find((d) => d.accountId === accountId && d.threadId === threadId);
  const last = messages.at(-1);
  const replyTo = last
    ? senderAddress(last.from).toLowerCase() === account?.address.toLowerCase()
      ? last.to
      : senderAddress(last.from)
    : "";

  const threadAction = (intent: "archive" | "markUnread") => {
    actions.submit({ intent, accountId, threadId }, { method: "post" });
    onClose();
  };

  const postComment = () => {
    if (!comment.trim()) return;
    commentFetcher.submit({ intent: "comment", accountId, threadId, body: comment }, { method: "post" });
    setComment("");
  };

  const deleteComment = async (commentId: string) => {
    const ok = await dialog.confirm({
      title: "Delete this comment?",
      description: "It disappears from the thread for everyone who can see it.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    commentFetcher.submit({ intent: "deleteComment", commentId }, { method: "post" });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 -mb-4 flex items-start gap-3 bg-os-bg pb-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-2xl font-medium text-foreground">
            {messages[0]?.subject || "(no subject)"}
          </h2>
          {account && <p className="mt-1 text-xs text-os-muted">{account.label}</p>}
        </div>
        <IconButton label="Mark unread" icon={MailOpen} onClick={() => threadAction("markUnread")} />
        <IconButton label="Archive" icon={Archive} onClick={() => threadAction("archive")} />
        {expandButton}
      </div>

      <div className="flex flex-col gap-3">
        {messages.map((m, i) => {
          const open = (i === messages.length - 1) !== toggled.has(m.id);
          const toggle = () =>
            setToggled((s) => {
              const next = new Set(s);
              if (!next.delete(m.id)) next.add(m.id);
              return next;
            });
          return (
            <article key={m.id} className="rounded-os-card bg-os-card">
              <button
                type="button"
                aria-expanded={open}
                className="group flex w-full flex-col gap-0.5 rounded-os-card px-4 pb-2 pt-4 text-left transition-colors hover:bg-os-hover active:bg-os-hover-strong"
                onClick={toggle}
              >
                <span className="flex w-full items-center gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">{senderName(m.from)}</span>
                  <span className="ml-auto shrink-0 text-xs text-os-muted">{shortDate(m.date)}</span>
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "h-4 w-4 shrink-0 text-os-muted transition-transform duration-200 group-hover:text-foreground",
                      open && "rotate-180",
                    )}
                  />
                </span>
                {open ? (
                  <span className="truncate text-xs text-os-muted">To {m.to}{m.cc ? `, cc ${m.cc}` : ""}</span>
                ) : (
                  <span className="truncate text-sm text-os-muted">{m.text?.slice(0, 160) ?? ""}</span>
                )}
              </button>
              {open && (
                <div className="px-4 pb-4 motion-safe:animate-area-menu">
                  <div className="mt-1">
                    <MailBody html={m.html} text={m.text} />
                  </div>
                  {m.attachments.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {m.attachments.map((att, index) => {
                        const chip = (
                          <>
                            <Paperclip className="h-3 w-3 shrink-0" />
                            <span className="truncate">{att.filename}</span>
                            {att.size > 0 && <span className="shrink-0 text-os-muted">{formatBytes(att.size)}</span>}
                          </>
                        );
                        const chipClass =
                          "inline-flex max-w-full items-center gap-1 rounded-full bg-os-container px-2.5 py-0.5 text-xs text-foreground";
                        // A part whose bytes came inline (no attachmentId) can't be
                        // fetched from Gmail, so it stays a plain, non-clickable chip.
                        return att.attachmentId ? (
                          <a
                            key={`${att.attachmentId}-${index}`}
                            href={`/api/email/attachment?account=${encodeURIComponent(accountId)}&thread=${encodeURIComponent(threadId)}&message=${encodeURIComponent(m.id)}&index=${index}`}
                            download={att.filename}
                            className={cn(chipClass, "hover:bg-os-container-hi")}
                          >
                            {chip}
                          </a>
                        ) : (
                          <span key={`${att.filename}-${index}`} className={chipClass}>
                            {chip}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {thread.applicantLinksEnabled && (
        <ApplicantLinkSection accountId={accountId} threadId={threadId} link={thread.applicantLink} />
      )}

      <section className="flex flex-col gap-2 rounded-os-card bg-os-container/60 p-4" aria-label="Private comments">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-os-muted">
          <Lock className="h-3.5 w-3.5" />
          Private comments. Only people with this inbox see them.
        </h3>
        {comments.map((c) => (
          <div key={c.id} className="group flex items-start gap-2">
            <Avatar name={c.author.name} photoUrl={c.author.photoUrl} userId={c.author.id} size="xs" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-os-muted">
                <span className="font-semibold text-foreground">{c.author.name}</span> · {shortDate(c.createdAt)}
              </p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{c.body}</p>
            </div>
            {c.mine && (
              <IconButton
                label="Delete comment"
                icon={Trash2}
                tone="destructive"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => void deleteComment(c.id)}
              />
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <MentionTextInput
            placeholder="Add a comment, @ to mention someone"
            value={comment}
            onChange={setComment}
            onKeyDown={(e) => {
              if (e.key === "Enter") postComment();
            }}
            wrapperClassName="relative min-w-0 flex-1"
            className="w-full rounded-[10px] bg-os-well px-3 py-2 text-sm text-foreground outline-none"
          />
          <Button variant="secondary" size="sm" onClick={postComment} disabled={!comment.trim()}>
            Comment
          </Button>
        </div>
      </section>

      {replying || threadDraft ? (
        <Composer
          key={threadDraft?.id ?? "new"}
          accounts={accounts}
          accountId={accountId}
          threadId={threadId}
          draft={threadDraft}
          replyTo={replyTo}
          aiEnabled={aiEnabled}
          directory={directory}
          onDone={() => setReplying(false)}
        />
      ) : (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setReplying(true)}>
            <Reply className="h-3.5 w-3.5" />
            Reply
          </Button>
        </div>
      )}
    </div>
  );
}
