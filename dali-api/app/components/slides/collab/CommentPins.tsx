import { Avatar } from "~/components/ui/Avatar";
import { cn } from "~/lib/cn";
import type { CommentPin } from "./comment-pins";

/** Avatar dots over the stage, one per pinned thread on the slide. */
export function CommentPins({ pins, focusedId, onOpen }: { pins: CommentPin[]; focusedId: string | null; onOpen: (threadId: string) => void }) {
  if (pins.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 20 }}>
      {pins.map((pin) => (
        <button
          key={pin.threadId}
          type="button"
          data-comment-pin={pin.threadId}
          aria-label={`Comment by ${pin.author}${pin.replies ? `, ${pin.replies} ${pin.replies === 1 ? "reply" : "replies"}` : ""}`}
          onClick={() => onOpen(pin.threadId)}
          className={cn(
            "pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-os-card",
            focusedId === pin.threadId && "ring-os-accent",
          )}
          style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
        >
          <Avatar name={pin.author} photoUrl={pin.authorPhotoUrl} size="compact" />
        </button>
      ))}
    </div>
  );
}
