import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";
import { areaIconFor, areaTint } from "~/lib/nav-areas";

export type AreaTileSize = 20 | 22 | 24 | 26 | 32 | 40;

const RADIUS: Record<AreaTileSize, string> = {
  20: "rounded-[6px]",
  22: "rounded-[6px]",
  24: "rounded-[7px]",
  26: "rounded-[7px]",
  32: "rounded-[8px]",
  40: "rounded-[10px]",
};

// The section "logo": the area's accent as a translucent wash with the glyph
// drawn in the accent itself, so the tile always matches the rail's tinting.
export function AreaTile({
  areaKey,
  size,
  icon,
}: {
  areaKey: string;
  size: AreaTileSize;
  icon?: LucideIcon;
}) {
  const Icon = icon ?? areaIconFor(areaKey);
  const tint = areaTint(areaKey);
  if (!Icon) return null;
  const glyph = Math.round(size * 0.6);
  return (
    <span
      data-area-tile={areaKey}
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center", RADIUS[size])}
      style={{
        width: size,
        height: size,
        backgroundColor: `${tint}2e`,
        color: tint,
      }}
    >
      <Icon width={glyph} height={glyph} />
    </span>
  );
}
