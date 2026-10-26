import type { CSSProperties } from "react";
import { cn } from "~/lib/cn";
import { AUTH_TILES, AUTH_TILE_GRID, type AuthTile } from "~/components/auth/auth-tiles";

// The framer-motion prototype re-done as pure CSS (keyframes in app.css,
// `auth-tile-*`): each tile pops in diagonally, then runs its own idle loop —
// sliding to an empty cell, flipping colour pairs, orbiting, breathing or
// spinning. Loops start after the entrance and respect reduced motion through
// the motion-safe gate on every animation class.

const pct = (n: number, of: number) => `${(n / of) * 100}%`;

const LOOP_CLASS: Partial<Record<AuthTile["loop"], string>> = {
  breathe: "motion-safe:animate-auth-tile-breathe",
  orbit: "motion-safe:animate-auth-tile-orbit",
  spin: "motion-safe:animate-auth-tile-spin",
};

export function AnimatedTileCluster() {
  const { columns, rows } = AUTH_TILE_GRID;
  return (
    <div className="relative w-full" style={{ aspectRatio: `${columns} / ${rows}` }} aria-hidden>
      {AUTH_TILES.map((tile) => (
        <Tile key={tile.id} tile={tile} columns={columns} rows={rows} />
      ))}
    </div>
  );
}

function Tile({ tile, columns, rows }: { tile: AuthTile; columns: number; rows: number }) {
  const left = pct(tile.col, columns);
  const top = pct(tile.row, rows);
  const loopDelay = `${0.9 + tile.delay}s`;
  const entranceDelay = `${0.25 + (tile.col + tile.row) * 0.05}s`;

  const slideVars: CSSProperties =
    tile.loop === "slide"
      ? ({
          "--tile-l0": left,
          "--tile-t0": top,
          "--tile-l1": pct(tile.toCol ?? tile.col, columns),
          "--tile-t1": pct(tile.toRow ?? tile.row, rows),
          animationDelay: loopDelay,
        } as CSSProperties)
      : {};

  return (
    <div
      className={cn("absolute", tile.loop === "slide" && "motion-safe:animate-auth-tile-slide")}
      style={{ width: pct(1, columns), height: pct(1, rows), left, top, ...slideVars }}
    >
      <div className="h-full w-full motion-safe:animate-auth-tile-pop" style={{ animationDelay: entranceDelay }}>
        <div
          className={cn("h-full w-full", tile.loop === "flip" && "motion-safe:animate-auth-tile-flip")}
          style={
            {
              backgroundColor: "var(--tile-bg)",
              color: "var(--tile-fg)",
              "--tile-bg": tile.bg,
              "--tile-fg": tile.fg,
              "--tile-alt-bg": tile.altBg ?? tile.bg,
              "--tile-alt-fg": tile.altFg ?? tile.fg,
              animationDelay: loopDelay,
            } as CSSProperties
          }
        >
          <Motif tile={tile} loopDelay={loopDelay} />
        </div>
      </div>
    </div>
  );
}

function Motif({ tile, loopDelay }: { tile: AuthTile; loopDelay: string }) {
  const loopClass = LOOP_CLASS[tile.loop];
  const loopStyle = loopClass ? { animationDelay: loopDelay } : undefined;

  if (tile.motif === "solid") return null;

  if (tile.motif === "quarter") {
    return <div className="absolute bottom-0 left-0 h-[60%] w-[60%] rounded-tr-full bg-current" />;
  }

  if (tile.motif === "dot" || tile.motif === "loose") {
    const size = tile.motif === "loose" ? "h-[40%] w-[40%]" : tile.loop === "orbit" ? "h-[36%] w-[36%]" : "h-1/2 w-1/2";
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className={cn("rounded-full bg-current", size, loopClass)} style={loopStyle} />
      </div>
    );
  }

  if (tile.motif === "ring") {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div
          className={cn("flex h-[60%] w-[60%] items-center justify-center rounded-full bg-current", loopClass)}
          style={loopStyle}
        >
          <div className="h-3/5 w-3/5 rounded-full" style={{ background: "var(--tile-bg)" }} />
        </div>
      </div>
    );
  }

  // flower: four petals around a hole in the tile's own colour.
  return (
    <div className={cn("absolute inset-0", tile.loop === "spin" && LOOP_CLASS.spin)} style={loopStyle}>
      <div className="absolute left-[33%] top-[14%] h-[34%] w-[34%] rounded-full bg-current" />
      <div className="absolute left-[52%] top-[33%] h-[34%] w-[34%] rounded-full bg-current" />
      <div className="absolute left-[33%] top-[52%] h-[34%] w-[34%] rounded-full bg-current" />
      <div className="absolute left-[14%] top-[33%] h-[34%] w-[34%] rounded-full bg-current" />
      <div className="absolute left-[42%] top-[42%] h-[16%] w-[16%] rounded-full" style={{ background: "var(--tile-bg)" }} />
    </div>
  );
}
