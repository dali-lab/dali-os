import { useRef } from "react";
import { useFetcher } from "react-router";
import { SmilePlus } from "lucide-react";
import { cn } from "~/lib/cn";
import {
  MAX_REACTION_EMOJI,
  customEmojiName,
  reactionSentence,
  toggleReaction,
  type ReactionSummary,
} from "~/lib/reactions";
import { EmojiPicker } from "~/components/EmojiPicker";
import { Popover, Tooltip } from "~/components/ui/floating";
import { OS_PANEL_CLASS } from "~/components/ui/floating/styles";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent";

const CHIP = `inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-semibold tabular-nums transition-colors ${FOCUS}`;

const SIZES = { sm: { img: "h-4 w-4", text: "text-sm" }, lg: { img: "h-9 w-9", text: "text-3xl" } };

/** A standard emoji, a custom image, or ":name:" once a custom emoji is deleted. */
export function ReactionEmoji({
  emoji,
  imageUrl,
  size = "sm",
}: {
  emoji: string;
  imageUrl?: string | null;
  size?: keyof typeof SIZES;
}) {
  if (imageUrl) {
    return <img src={imageUrl} alt={emoji} className={cn(SIZES[size].img, "object-contain")} />;
  }
  if (customEmojiName(emoji)) return <span>{emoji}</span>;
  return (
    <span aria-hidden className={SIZES[size].text}>
      {emoji}
    </span>
  );
}

function ReactionChip({
  reaction,
  onReact,
}: {
  reaction: ReactionSummary;
  onReact: (emoji: string) => void;
}) {
  const { emoji, count, mine, imageUrl } = reaction;
  const sentence = reactionSentence(reaction);
  return (
    <Tooltip
      variant="rich"
      content={
        sentence && (
          <span className="flex flex-col items-center gap-1 text-center">
            <ReactionEmoji emoji={emoji} imageUrl={imageUrl} size="lg" />
            {sentence}
          </span>
        )
      }
    >
      <button
        type="button"
        aria-pressed={mine}
        aria-label={`${emoji} ${count}`}
        // Nobody new can react with a deleted emoji; the viewer can still take theirs back.
        disabled={imageUrl === null && !mine}
        onClick={() => onReact(emoji)}
        className={cn(
          CHIP,
          mine
            ? "border-os-accent bg-os-accent/15 text-os-accent hover:bg-os-accent/25"
            : "border-transparent bg-os-container text-os-grey hover:border-os-container-hi hover:text-foreground",
        )}
      >
        <ReactionEmoji emoji={emoji} imageUrl={imageUrl} />
        {count}
      </button>
    </Tooltip>
  );
}

/** Emoji chips with counts, then a chip for adding one. Shared by Feedback and Gallery. */
export function ReactionBar({
  reactions,
  palette,
  onReact,
  className,
}: {
  reactions: ReactionSummary[];
  /** The picker's quick row. */
  palette: readonly string[];
  onReact: (emoji: string, imageUrl?: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {reactions.map((r) => (
        <ReactionChip key={r.emoji} reaction={r} onReact={onReact} />
      ))}
      {reactions.length < MAX_REACTION_EMOJI && (
        <ReactionPicker palette={palette} onReact={onReact} chip />
      )}
    </div>
  );
}

/**
 * Posts `intent=react` and shows the toggle until the loader catches up. Read
 * off the fetcher rather than held in state, so a refused reaction rolls back.
 */
export function useReactionToggle(postId: string, reactions: ReactionSummary[]) {
  const fetcher = useFetcher();
  // A form field can't carry the image a new custom chip needs to show at once.
  const images = useRef(new Map<string, string>());
  const pending = fetcher.formData?.get("emoji");
  return {
    reactions:
      typeof pending === "string"
        ? toggleReaction(reactions, pending, images.current.get(pending))
        : reactions,
    react: (emoji: string, imageUrl?: string) => {
      if (imageUrl) images.current.set(emoji, imageUrl);
      fetcher.submit({ intent: "react", postId, emoji }, { method: "post" });
    },
  };
}

export function ReactionPicker({
  palette,
  onReact,
  chip = false,
}: {
  palette: readonly string[];
  onReact: (emoji: string, imageUrl?: string) => void;
  /** Sit at the end of a chip row, in the chips' shape. */
  chip?: boolean;
}) {
  return (
    // panelClassName replaces the Popover's surface rather than adding to it,
    // so it has to carry the panel dress itself.
    <Popover
      ariaLabel="Add reaction"
      panelClassName={cn(OS_PANEL_CLASS, "w-[336px] max-w-[calc(100vw-16px)]")}
      trigger={
        <button
          type="button"
          aria-label="Add reaction"
          className={
            chip
              ? cn(
                  CHIP,
                  "border-transparent bg-os-container text-os-grey hover:border-os-container-hi hover:text-foreground aria-expanded:border-os-container-hi aria-expanded:text-foreground",
                )
              : cn(
                  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-os-grey transition-colors hover:bg-os-container hover:text-foreground aria-expanded:bg-os-container aria-expanded:text-foreground",
                  FOCUS,
                )
          }
        >
          <SmilePlus className={chip ? "size-3.5" : "size-4"} aria-hidden />
        </button>
      }
    >
      {(close) => (
        <EmojiPicker
          quick={palette}
          onClose={close}
          onPick={(emoji, imageUrl) => {
            onReact(emoji, imageUrl);
            close();
          }}
        />
      )}
    </Popover>
  );
}
