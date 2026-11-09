import type { FloatingReaction } from "./useReactions";

/** Emoji that float up the stage as people react. They never take clicks. */
export function ReactionOverlay({ items }: { items: FloatingReaction[] }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-20 overflow-hidden" data-testid="reaction-overlay">
      {items.map((r) => (
        <span key={r.id} className="slide-reaction absolute bottom-6 text-5xl" style={{ left: `${r.left}%` }} data-reaction={r.emoji}>
          {r.emoji}
        </span>
      ))}
    </div>
  );
}
