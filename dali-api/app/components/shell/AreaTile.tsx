import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";
import { AREA_TONES, areaIconFor } from "~/lib/nav-areas";

export type AreaTileSize = 20 | 22 | 26 | 32 | 40;

const DIMENSIONS: Record<AreaTileSize, { radius: string; glyph: number }> = {
  20: { radius: "rounded-[6px]", glyph: 12 },
  22: { radius: "rounded-[6px]", glyph: 13 },
  26: { radius: "rounded-[7px]", glyph: 14 },
  32: { radius: "rounded-[8px]", glyph: 17 },
  40: { radius: "rounded-[10px]", glyph: 22 },
};

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
  const tone = AREA_TONES[areaKey];
  const { radius, glyph } = DIMENSIONS[size];
  if (!Icon) return null;
  return (
    <span
      data-area-tile={areaKey}
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center",
        radius,
        !tone && "bg-os-container text-os-grey",
        tone?.ring && "area-tile-ring",
      )}
      style={{
        width: size,
        height: size,
        ...(tone && {
          background: tone.tile,
          color: tone.glyph,
          ...(tone.outline && { border: "1px solid #C6CACC" }),
        }),
      }}
    >
      <Icon width={glyph} height={glyph} />
    </span>
  );
}
