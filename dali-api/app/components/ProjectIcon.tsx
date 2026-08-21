import { FolderKanban } from "lucide-react";

/**
 * Leading icon for a project: the project's custom `iconEmoji` when set,
 * otherwise a neutral project glyph. Fixed-width slot so names stay aligned
 * whether or not a project has a custom emoji. Mirrors the document PageIcon.
 */
// Fixed slots for the two long-standing sizes, plus "inherit", which sizes the
// glyph off the surrounding type instead. The dali.os surfaces set the icon
// beside 20px and 32px headings, and a 14px emoji in a 16px box next to a 32px
// title reads as a missing icon rather than a small one.
const SLOT = {
  sm: { box: "w-4", emoji: "text-sm", glyph: "h-3.5 w-3.5" },
  lg: { box: "w-8", emoji: "text-2xl", glyph: "h-6 w-6" },
  inherit: { box: "w-[1.1em]", emoji: "text-[1em]", glyph: "h-[0.9em] w-[0.9em]" },
} as const;

export function ProjectIcon({
  iconEmoji,
  size = "sm",
  className,
}: {
  iconEmoji?: string | null;
  size?: keyof typeof SLOT;
  className?: string;
}) {
  const slot = SLOT[size];
  return (
    <span
      className={`flex flex-shrink-0 items-center justify-center leading-none ${slot.box}${className ? ` ${className}` : ""}`}
      aria-hidden
    >
      {iconEmoji ? (
        <span className={slot.emoji}>{iconEmoji}</span>
      ) : (
        <FolderKanban className={`text-muted-foreground ${slot.glyph}`} />
      )}
    </span>
  );
}
