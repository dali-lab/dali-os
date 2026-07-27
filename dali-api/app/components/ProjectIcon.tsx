import { FolderKanban } from "lucide-react";

/**
 * Leading icon for a project: the project's custom `iconEmoji` when set,
 * otherwise a neutral project glyph. Fixed-width slot so names stay aligned
 * whether or not a project has a custom emoji. Mirrors the document PageIcon.
 */
export function ProjectIcon({
  iconEmoji,
  size = "sm",
  className,
}: {
  iconEmoji?: string | null;
  size?: "sm" | "lg";
  className?: string;
}) {
  const lg = size === "lg";
  return (
    <span
      className={`flex flex-shrink-0 items-center justify-center leading-none ${lg ? "w-8" : "w-4"}${className ? ` ${className}` : ""}`}
      aria-hidden
    >
      {iconEmoji ? (
        <span className={lg ? "text-2xl" : "text-sm"}>{iconEmoji}</span>
      ) : (
        <FolderKanban className={`text-muted-foreground ${lg ? "h-6 w-6" : "h-3.5 w-3.5"}`} />
      )}
    </span>
  );
}
