import { useId, useState } from "react";
import { useFetcher } from "react-router";
import { Check, Coffee, MoreHorizontal } from "lucide-react";
import type { OpportunityFeedPost } from "~/community/lib/opportunities-feed.server";
import {
  CHAT_MATCH_REASON_COPY,
  OPPORTUNITY_COMMENT_MAX,
  OPPORTUNITY_NOTE_MAX,
  OPPORTUNITY_REACTION_EMOJI,
} from "~/community/lib/opportunities";
import { LogoBlock } from "~/community/components/opportunities/LogoBlock";
import { cn } from "~/lib/cn";
import { relativeTime } from "~/lib/relative-time";
import { useOsChrome } from "~/components/os-chrome";
import { Modal } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { Avatar } from "~/components/ui/Avatar";
import { Button } from "~/components/ui/Button";
import { FormField } from "~/components/ui/FormField";
import { IconButton } from "~/components/ui/IconButton";
import { Menu, MenuItem } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { PostComments } from "~/components/PostComments";
import { ReactionBar, useReactionToggle } from "~/components/ReactionBar";

type Post = OpportunityFeedPost;

function Byline({ post }: { post: Post }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="font-semibold text-foreground">{post.author.name}</span>
      <span className="text-xs text-os-grey" suppressHydrationWarning>
        {relativeTime(post.createdAt)}
      </span>
      {post.author.classYear && <span className="text-xs text-os-muted">Class of {post.author.classYear}</span>}
    </p>
  );
}

function DoneButton({ label }: { label: string }) {
  return (
    <Button variant="secondary" size="sm" disabled className="shrink-0">
      <Check className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  );
}

function InterestedDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
}) {
  const titleId = useId();
  const { formClass } = useOsChrome();
  const [note, setNote] = useState("");
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} containerClassName={modalCardClass("max-w-md")}>
      <form
        className={cn(formClass, "flex flex-col gap-4")}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(note.trim());
        }}
      >
        <h2 id={titleId} className="font-heading text-xl font-semibold text-foreground">
          Say you're interested
        </h2>
        <FormField
          label="Note (optional)"
          multiline
          rows={3}
          value={note}
          onChange={(v) => setNote(v.slice(0, OPPORTUNITY_NOTE_MAX))}
          placeholder="Anything you want them to know"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Send</Button>
        </div>
      </form>
    </Modal>
  );
}

function JobAttachment({ post }: { post: Post }) {
  const job = post.job!;
  const respond = useFetcher();
  const [asking, setAsking] = useState(false);
  const responded = post.viewerResponded || respond.formData?.get("intent") === "interested";
  const meta = [job.companyName, job.location, job.jobType, job.willRefer ? "Will refer" : null].filter(Boolean);
  return (
    <div className="flex items-center gap-3 rounded-os-item border border-os-container bg-os-well p-3">
      <LogoBlock name={job.companyName ?? "?"} logoUrl={job.logoUrl} color={job.blockColor} size={40} />
      <div className="min-w-0 flex-1">
        {job.url ? (
          <a href={job.url} target="_blank" rel="noreferrer" className="block truncate font-semibold text-foreground hover:underline">
            {job.role}
          </a>
        ) : (
          <p className="truncate font-semibold text-foreground">{job.role}</p>
        )}
        <p className="truncate text-xs text-os-grey">{meta.join(" · ")}</p>
      </div>
      {!post.isOwn && post.author.id !== null && (
        responded ? (
          <DoneButton label="Interested" />
        ) : (
          <Button size="sm" className="shrink-0" onClick={() => setAsking(true)}>
            I'm interested
          </Button>
        )
      )}
      {asking && (
        <InterestedDialog
          open
          onClose={() => setAsking(false)}
          onSubmit={(note) => {
            setAsking(false);
            respond.submit({ intent: "interested", postId: post.id, note }, { method: "post" });
          }}
        />
      )}
    </div>
  );
}

function ChatAttachment({ post }: { post: Post }) {
  const respond = useFetcher();
  const responded = post.viewerResponded || respond.formData?.get("intent") === "offer-chat";
  const detail = [
    post.matchReason ? CHAT_MATCH_REASON_COPY[post.matchReason] : null,
    post.responseCount > 0 ? `${post.responseCount} offered` : null,
  ].filter(Boolean);
  return (
    <div className="flex items-center gap-3 rounded-os-item border border-os-container bg-os-well p-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-os-item bg-os-card text-os-accent">
        <Coffee className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-foreground">Coffee chat · {post.topic}</p>
        {detail.length > 0 && <p className="truncate text-xs text-os-grey">{detail.join(" · ")}</p>}
      </div>
      {!post.isOwn &&
        (responded ? (
          <DoneButton label="Offered" />
        ) : (
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => respond.submit({ intent: "offer-chat", postId: post.id }, { method: "post" })}
          >
            Offer a chat
          </Button>
        ))}
    </div>
  );
}

function PostMenu({ post }: { post: Post }) {
  const dialog = useDialog();
  const act = useFetcher();
  const closeLabel = post.kind === "Job" ? "Mark as filled" : "Mark as done";
  if (!post.canDelete && !post.canClose) return null;

  async function onDelete() {
    const ok = await dialog.confirm({
      title: "Delete this post?",
      description: "Its reactions and comments go with it.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (ok) act.submit({ intent: "delete", postId: post.id }, { method: "post" });
  }

  return (
    <Menu trigger={<IconButton label="More" icon={MoreHorizontal} />} align="right">
      {post.canClose && (
        <MenuItem onSelect={() => act.submit({ intent: "close", postId: post.id }, { method: "post" })}>
          {closeLabel}
        </MenuItem>
      )}
      {post.canDelete && (
        <MenuItem destructive onSelect={() => void onDelete()}>
          Delete
        </MenuItem>
      )}
    </Menu>
  );
}

function StillOpenPrompt({ post }: { post: Post }) {
  const act = useFetcher();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-os-item bg-os-well px-3 py-2 text-sm text-foreground">
      <span className="mr-auto">Is this still open?</span>
      <Button
        size="xs"
        variant="secondary"
        onClick={() => act.submit({ intent: "keep-open", postId: post.id }, { method: "post" })}
      >
        Still open
      </Button>
      <Button size="xs" variant="secondary" onClick={() => act.submit({ intent: "close", postId: post.id }, { method: "post" })}>
        Filled
      </Button>
    </div>
  );
}

function Reactions({ post }: { post: Post }) {
  const { reactions, react } = useReactionToggle(post.id, post.reactions);
  return <ReactionBar reactions={reactions} palette={OPPORTUNITY_REACTION_EMOJI} onReact={react} />;
}

export function OpportunityPostCard({ post }: { post: Post }) {
  const { card, panelPad } = useOsChrome();
  return (
    <article className={cn(card, panelPad, "flex flex-col gap-4")}>
      <div className="flex items-start gap-3">
        <Avatar size="md" name={post.author.name} photoUrl={post.author.photoUrl} />
        <div className="min-w-0 flex-1">
          <Byline post={post} />
          <p className="mt-1 whitespace-pre-wrap break-words text-[15px] text-foreground">{post.body}</p>
        </div>
        <PostMenu post={post} />
      </div>
      {post.kind === "Job" && post.job && <JobAttachment post={post} />}
      {post.kind === "ChatAsk" && <ChatAttachment post={post} />}
      {post.kind === "DaliUpdate" && post.imageUrl && (
        <img
          src={post.imageUrl}
          alt=""
          loading="lazy"
          className="max-h-[420px] w-full rounded-os-item border border-os-container bg-os-well object-contain"
        />
      )}
      {post.askStillOpen && <StillOpenPrompt post={post} />}
      <Reactions post={post} />
      <PostComments postId={post.id} comments={post.comments} maxLength={OPPORTUNITY_COMMENT_MAX} />
    </article>
  );
}
