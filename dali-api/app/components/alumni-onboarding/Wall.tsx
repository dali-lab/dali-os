import type { CSSProperties } from "react";
import { cn } from "~/lib/cn";
import { AUTH_TILE_GRID, type AuthTile } from "~/components/auth/auth-tiles";
import { TileMotif } from "~/components/auth/AnimatedTileCluster";
import { WALL_FILL_ORDER, WALL_SIZE } from "~/lib/alumni-onboarding";

const pct = (n: number, of: number) => `${(n / of) * 100}%`;

export function BlockTile({
  tile,
  motif = tile.motif,
  className,
}: {
  tile: Pick<AuthTile, "bg" | "fg" | "motif">;
  motif?: AuthTile["motif"];
  className?: string;
}) {
  return (
    <div
      className={cn("relative h-full w-full", className)}
      style={{ backgroundColor: tile.bg, color: tile.fg, "--tile-bg": tile.bg } as CSSProperties}
    >
      <TileMotif motif={motif} />
    </div>
  );
}

/** The 8 by 4 wall that fills block by block as the alumnus moves through the steps. */
export function BlockWall({ filled }: { filled: number }) {
  const { columns, rows } = AUTH_TILE_GRID;
  const count = Math.min(filled, WALL_SIZE);
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-baseline gap-2.5">
        <span className="font-os text-[28px] font-extrabold leading-[34px] text-foreground tabular-nums">
          {count}
        </span>
        <span className="text-base text-os-grey">of {WALL_SIZE}</span>
      </div>
      <div
        className="relative w-full max-w-[544px]"
        style={{ aspectRatio: `${columns} / ${rows}` }}
        role="img"
        aria-label={`${count} of ${WALL_SIZE} blocks placed`}
      >
        {WALL_FILL_ORDER.map((tile, i) => {
          const placed = i < count;
          return (
            <div
              key={tile.id}
              data-placed={placed}
              className="absolute"
              style={{
                width: pct(1, columns),
                height: pct(1, rows),
                left: pct(tile.col, columns),
                top: pct(tile.row, rows),
              }}
            >
              {placed ? (
                <div className="h-full w-full motion-safe:animate-auth-tile-pop">
                  <BlockTile tile={tile} />
                </div>
              ) : (
                <div className="h-full w-full p-[7%]">
                  <div className="h-full w-full rounded-sm border-[1.5px] border-dashed border-os-container-hi" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
