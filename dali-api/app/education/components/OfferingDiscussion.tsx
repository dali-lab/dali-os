import { useState } from "react";
import { Form } from "react-router";
import { Megaphone, MessageSquare, Reply } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { Avatar } from "~/components/ui/Avatar";
import { AddFormModal } from "./AddFormModal";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";

// The offering's discussion, shared by the manage page and the course hub.
//
// Two kinds of post: an Announcement, which notifies every enrollee in-app and
// by email, and a Message, which doesn't. Instructors can send either; students
// send Messages. Anyone in the offering can reply to any top-level post, and
// replies never notify — a thread that emails the whole course on every reply
// stops being a thread.
//
// `canAnnounce` is the only difference between the two surfaces: it's the
// server's isOfferingManager answer, and the server re-checks it on every post,
// so hiding the control here is a courtesy, not the gate.

export type DiscussionReply = {
  id: string;
  body: string;
  sentAt: string | Date;
  authorId: string;
  author: { firstName: string; lastName: string };
};

export type DiscussionPost = DiscussionReply & {
  kind: "Announcement" | "Message";
  replies: DiscussionReply[];
};

const name = (a: { firstName: string; lastName: string }) =>
  `${a.firstName} ${a.lastName}`.trim();

export function OfferingDiscussion({
  posts,
  currentUserId,
  canAnnounce = false,
}: {
  posts: DiscussionPost[];
  currentUserId: string;
  /** Offering managers only — students can't broadcast. */
  canAnnounce?: boolean;
}) {
  const tz = useUserTimeZone();
  const [composeKind, setComposeKind] = useState<"Announcement" | "Message" | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          {canAnnounce
            ? "Announcements notify every enrollee. Messages stay here."
            : "Ask a question or reply to a post — your instructors will see it."}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setComposeKind("Message")}>
            New message
          </Button>
          {canAnnounce && (
            <Button type="button" size="sm" onClick={() => setComposeKind("Announcement")}>
              New announcement
            </Button>
          )}
        </div>
      </div>

      {posts.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          Nothing posted yet — start the conversation above.
        </p>
      )}

      {posts.map((p) => {
        const announcement = p.kind === "Announcement";
        return (
          <article
            key={p.id}
            className={`rounded-lg border p-4 ${
              // An announcement is the one post that interrupted everybody, so
              // it stays visually distinct in the scrollback.
              announcement
                ? "border-accent-coral/30 bg-accent-coral/5"
                : "border-border bg-card"
            }`}
          >
            <header className="flex flex-wrap items-center gap-2">
              <Avatar name={name(p.author)} size="xs" />
              <span className="text-sm font-medium text-foreground">{name(p.author)}</span>
              {announcement && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-coral/15 px-2 py-0.5 text-[10px] font-semibold text-accent-coral">
                  <Megaphone className="h-3 w-3" />
                  Announcement
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {formatDateTime(p.sentAt as never, tz)}
              </span>
            </header>

            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{p.body}</p>

            {p.replies.length > 0 && (
              <ul className="mt-3 flex flex-col gap-3 border-l-2 border-border pl-3">
                {p.replies.map((r) => (
                  <li key={r.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Avatar name={name(r.author)} size="xs" />
                      <span className="text-sm font-medium text-foreground">
                        {name(r.author)}
                      </span>
                      {r.authorId === currentUserId && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          You
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(r.sentAt as never, tz)}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{r.body}</p>
                  </li>
                ))}
              </ul>
            )}

            {replyTo === p.id ? (
              <Form
                method="post"
                onSubmit={() => queueMicrotask(() => setReplyTo(null))}
                className="mt-3 flex flex-col gap-2"
              >
                <input type="hidden" name="intent" value="post-announcement" />
                <input type="hidden" name="parentId" value={p.id} />
                <input type="hidden" name="kind" value="Message" />
                <label className="sr-only" htmlFor={`reply-${p.id}`}>
                  Reply
                </label>
                <textarea
                  id={`reply-${p.id}`}
                  name="body"
                  required
                  rows={2}
                  autoFocus
                  placeholder="Write a reply…"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setReplyTo(null)}
                    className="text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <Button type="submit" size="sm">
                    Reply
                  </Button>
                </div>
              </Form>
            ) : (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setReplyTo(p.id)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  <Reply className="h-3.5 w-3.5" />
                  Reply
                </button>
              </div>
            )}
          </article>
        );
      })}

      <AddFormModal
        open={composeKind !== null}
        onClose={() => setComposeKind(null)}
        title={composeKind === "Announcement" ? "New announcement" : "New message"}
        subtitle={
          composeKind === "Announcement"
            ? "Goes to every approved enrollee — in-app and by email."
            : "Posted to the discussion. Nobody is emailed."
        }
        intent="post-announcement"
        submitLabel={composeKind === "Announcement" ? "Send announcement" : "Post message"}
        hiddenFields={{ kind: composeKind ?? "Message" }}
      >
        <label className="block">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            {composeKind === "Announcement" ? (
              <Megaphone className="h-3.5 w-3.5" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5" />
            )}
            Message
          </span>
          <textarea
            name="body"
            required
            rows={4}
            placeholder={
              composeKind === "Announcement"
                ? "Reminder: bring your laptops tomorrow…"
                : "Share a link, ask a question…"
            }
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </label>
      </AddFormModal>
    </div>
  );
}
