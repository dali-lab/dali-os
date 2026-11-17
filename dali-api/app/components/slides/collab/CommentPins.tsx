import { Avatar, type AvatarSize } from "~/components/ui/Avatar";
import { Tooltip } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import type { CommentPin } from "./comment-pins";

const repliesLabel = (n: number) => `${n} ${n === 1 ? "reply" : "replies"}`;

/** Avatar dots over a stage or image, one per pinned thread. A pin with a `preview` shows it on hover. */
export function CommentPins({
  pins,
  focusedId,
  onOpen,
  size = "compact",
}: {
  pins: CommentPin[];
  focusedId: string | null;
  onOpen: (threadId: string) => void;
  size?: AvatarSize;
}) {
  if (pins.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 20 }}>
      {pins.map((pin) => {
        const button = (
          <button
            key={pin.threadId}
            type="button"
            data-comment-pin={pin.threadId}
            aria-label={`Comment by ${pin.author}${pin.replies ? `, ${repliesLabel(pin.replies)}` : ""}`}
            onClick={() => onOpen(pin.threadId)}
            className={cn(
              "pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-os-card",
              focusedId === pin.threadId && "ring-os-accent",
            )}
            style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
          >
            <Avatar name={pin.author} photoUrl={pin.authorPhotoUrl} size={size} />
          </button>
        );
        if (pin.preview === undefined) return button;
        return (
          <Tooltip
            key={pin.threadId}
            variant="rich"
            content={
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{pin.author}</span>
                <span className="line-clamp-2 [overflow-wrap:anywhere]">{pin.preview}</span>
                {pin.replies > 0 && <span className="text-muted-foreground">{repliesLabel(pin.replies)}</span>}
              </span>
            }
          >
            {button}
          </Tooltip>
        );
      })}
    </div>
  );
}
