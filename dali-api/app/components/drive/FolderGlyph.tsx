import type { ReactNode } from "react";
import { CalendarDays, Folder, FolderCog } from "lucide-react";
import { cn } from "~/lib/cn";
import type { ItemGlyph } from "~/components/drive/glyphs";

/** A small mark pinned to a glyph's bottom-right corner, on a disc that cuts it out of the artwork. */
export function GlyphBadge({ children, badge }: { children: ReactNode; badge: ReactNode }) {
  return (
    <span className="relative inline-flex shrink-0">
      {children}
      <span className="absolute -bottom-1 -right-1 flex items-center justify-center rounded-full bg-background">
        {badge}
      </span>
    </span>
  );
}

type FolderLook = Pick<Extract<ItemGlyph, { kind: "folder" }>, "tint" | "mark" | "system">;

/** The one drawing of a folder: system folders get the cog folder, Meetings folders a calendar mark. */
export function FolderGlyph({
  glyph,
  className,
  markClassName,
}: {
  glyph: FolderLook;
  className: string;
  markClassName: string;
}) {
  const Icon = glyph.system ? FolderCog : Folder;
  const folder = <Icon className={cn(className, glyph.tint, "shrink-0")} aria-hidden />;
  if (!glyph.mark) return folder;
  return <GlyphBadge badge={<CalendarDays className={cn(markClassName, glyph.tint)} aria-hidden />}>{folder}</GlyphBadge>;
}
