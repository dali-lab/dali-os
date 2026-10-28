import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { TileMotif } from "~/components/auth/AnimatedTileCluster";
import { canAnimate, prefersReducedMotion } from "~/components/meeting-recorder/motion";
import {
  FOLD_STEPS,
  STRIP_COLUMNS,
  STRIP_ROWS,
  foldFrames,
  type FoldStep,
  type StripCell,
} from "~/forms/lib/tile-strip";

export type TileStripPhase = "idle" | "folding" | "folded" | "settled";

export const TILE_MOTION = { strip: 255, square: 340, settle: 935, fadeDelay: 400, fade: 1063 } as const;

const FOLD_EASE = "cubic-bezier(.45,0,.55,1)";

const ORIGIN: Record<FoldStep["hinge"], string> = { left: "0% 50%", bottom: "50% 100%", top: "50% 0%" };

const TURN: Record<FoldStep["hinge"], (deg: number) => string> = {
  left: (deg) => `rotateY(${-deg}deg)`,
  bottom: (deg) => `rotateX(${-deg}deg)`,
  top: (deg) => `rotateX(${deg}deg)`,
};

const pct = (n: number) => `${n * 100}%`;

function Tile({ cell, style }: { cell: StripCell; style: CSSProperties }) {
  if (!cell) return null;
  return (
    <div
      data-tile={cell.motif}
      className="absolute overflow-hidden"
      style={{ ...style, backgroundColor: cell.bg, color: cell.fg, "--tile-bg": cell.bg } as CSSProperties}
    >
      <TileMotif motif={cell.motif} />
    </div>
  );
}

function Flap({ step, cells, onDone }: { step: FoldStep; cells: StripCell[]; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!canAnimate(el) || prefersReducedMotion()) {
      done.current();
      return;
    }
    const turn = TURN[step.hinge];
    const animation = el.animate(
      [
        { transform: turn(0), filter: "brightness(1)" },
        { transform: turn(90), filter: "brightness(.82)" },
        { transform: turn(180), filter: "brightness(1)" },
      ],
      { duration: TILE_MOTION[step.kind], easing: FOLD_EASE, fill: "forwards" },
    );
    animation.onfinish = () => done.current();
    return () => animation.cancel();
  }, [step]);

  const cols = step.moves.map(([from]) => from % STRIP_COLUMNS);
  const rows = step.moves.map(([from]) => Math.floor(from / STRIP_COLUMNS));
  const minCol = Math.min(...cols);
  const minRow = Math.min(...rows);
  const spanCols = Math.max(...cols) - minCol + 1;
  const spanRows = Math.max(...rows) - minRow + 1;

  return (
    <div
      ref={ref}
      className="absolute z-[1]"
      style={{
        left: pct(minCol / STRIP_COLUMNS),
        top: pct(minRow / STRIP_ROWS),
        width: pct(spanCols / STRIP_COLUMNS),
        height: pct(spanRows / STRIP_ROWS),
        transformOrigin: ORIGIN[step.hinge],
      }}
    >
      {step.moves.map(([from], i) => (
        <Tile
          key={from}
          cell={cells[from]}
          style={{
            left: pct((cols[i] - minCol) / spanCols),
            top: pct((rows[i] - minRow) / spanRows),
            width: pct(1 / spanCols),
            height: pct(1 / spanRows),
          }}
        />
      ))}
    </div>
  );
}

export function FormTileStrip({
  cells,
  phase,
  onFolded,
}: {
  cells: StripCell[];
  phase: TileStripPhase;
  onFolded: () => void;
}) {
  const frames = useMemo(() => foldFrames(cells), [cells]);
  const [step, setStep] = useState(0);
  if (phase !== "folding" && step !== 0) setStep(0);

  const folding = phase === "folding";
  const current = folding ? FOLD_STEPS[step] : null;
  const frame = folding ? frames[step] : phase === "idle" ? frames[0] : frames[FOLD_STEPS.length];
  const settled = phase === "settled";
  const rows = settled ? 1 : STRIP_ROWS;
  const hidden = new Set(current?.moves.map(([from]) => from));

  const advance = () => {
    if (step + 1 < FOLD_STEPS.length) setStep(step + 1);
    else onFolded();
  };

  return (
    <div
      aria-hidden
      data-phase={phase}
      className="relative w-full shrink-0"
      style={{ aspectRatio: `${STRIP_COLUMNS} / ${rows}`, perspective: "700px" }}
    >
      {frame.slice(0, rows * STRIP_COLUMNS).map((cell, i) =>
        hidden.has(i) ? null : (
          <Tile
            key={i}
            cell={cell}
            style={{
              left: pct((i % STRIP_COLUMNS) / STRIP_COLUMNS),
              top: pct(Math.floor(i / STRIP_COLUMNS) / rows),
              width: pct(1 / STRIP_COLUMNS),
              height: pct(1 / rows),
            }}
          />
        ),
      )}
      {current && <Flap key={step} step={current} cells={frames[step]} onDone={advance} />}
      {settled && (
        <span
          className="absolute inset-y-0 flex items-center font-os-logo text-[15px] font-semibold text-os-accent motion-safe:animate-auth-rise"
          style={{ left: `calc(${pct(1 / STRIP_COLUMNS)} + 20px)` }}
        >
          dali.os
        </span>
      )}
    </div>
  );
}
