import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";
import { areaIconFor, areaInk, areaTint } from "~/lib/nav-areas";

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
  if (!Icon) return null;
  const glyph = Math.round(size * 0.6);
  return (
    <span
      data-area-tile={areaKey}
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center", RADIUS[size])}
      style={
        {
          width: size,
          height: size,
          // Both halves of the tone; app.css resolves `--tile` per mode, the
          // same way the rail's `--area` resolves (tint on dark, ink on light).
          "--tile-tint": areaTint(areaKey),
          "--tile-ink": areaInk(areaKey),
          backgroundColor: "color-mix(in srgb, var(--tile) 18%, transparent)",
          color: "var(--tile)",
        } as React.CSSProperties
      }
    >
      <Icon width={glyph} height={glyph} />
    </span>
  );
}
