import {
  ClipboardList,
  Compass,
  FileText,
  FolderKanban,
  GraduationCap,
  Handshake,
  NotebookPen,
  UserPlus,
} from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { iconForHref } from "~/lib/nav-areas";
import type { FavoritePage } from "~/lib/user-pages.server";

/**
 * Leading icon for a Favorites/Recent row. Pages show their emoji (or a doc
 * glyph); route favorites resolve to their real entity icon — a project's
 * emoji, a person's avatar, a partner org's logo — falling back to the area
 * glyph or a compass. Fixed 20px slot so titles stay aligned across kinds.
 *
 * `glyphClassName` colours the fallback lucide glyphs so the same component
 * reads on both the dark sidebar (`text-white/40`) and the light home panel
 * (`text-muted-foreground`).
 */
export function FavoriteIcon({
  page,
  glyphClassName = "text-muted-foreground",
  size = "sm",
}: {
  page: FavoritePage;
  glyphClassName?: string;
  // "lg" is the dali.os recents card, where the icon is the card's 24px
  // subject rather than a 20px marker in front of a row of text.
  size?: "sm" | "lg";
}) {
  const lg = size === "lg";
  const glyph = `${lg ? "h-6 w-6" : "h-4 w-4"} ${glyphClassName}`;
  const slot = `flex flex-shrink-0 items-center justify-center leading-none ${
    lg ? "h-7 w-7" : "h-5 w-5"
  }`;
  const emoji = lg ? "text-2xl" : "text-sm";

  switch (page.iconKind) {
    case "person":
      return <Avatar photoUrl={page.photoUrl} name={page.title || "?"} size={lg ? "sm" : "xs"} />;
    case "org":
      return page.photoUrl ? (
        <img
          src={page.photoUrl}
          alt=""
          className={`flex-shrink-0 rounded object-cover ${lg ? "h-7 w-7" : "h-5 w-5"}`}
        />
      ) : (
        <span className={slot} aria-hidden>
          <Handshake className={glyph} />
        </span>
      );
    case "project":
      return (
        <span className={slot} aria-hidden>
          {page.iconEmoji ? (
            <span className={emoji}>{page.iconEmoji}</span>
          ) : (
            <FolderKanban className={glyph} />
          )}
        </span>
      );
    case "page":
      return (
        <span className={slot} aria-hidden>
          {page.iconEmoji ? (
            <span className={emoji}>{page.iconEmoji}</span>
          ) : (
            <FileText className={glyph} />
          )}
        </span>
      );
    case "offering":
      return (
        <span className={slot} aria-hidden>
          <GraduationCap className={glyph} />
        </span>
      );
    case "note":
      return (
        <span className={slot} aria-hidden>
          <NotebookPen className={glyph} />
        </span>
      );
    case "form":
      return (
        <span className={slot} aria-hidden>
          <ClipboardList className={glyph} />
        </span>
      );
    case "hiring":
      return (
        <span className={slot} aria-hidden>
          <UserPlus className={glyph} />
        </span>
      );
    default: {
      const RouteIcon = iconForHref(page.href) ?? Compass;
      return (
        <span className={slot} aria-hidden>
          <RouteIcon className={glyph} />
        </span>
      );
    }
  }
}
