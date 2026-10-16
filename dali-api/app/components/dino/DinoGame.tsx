import { useCallback, useEffect, useRef, useState } from "react";
import {
  GROUND_Y,
  RUNNER,
  STAGE,
  createGame,
  press,
  step,
  type GameState,
} from "~/components/dino/dino-engine";

const HIGH_SCORE_KEY = "dali:dino-high-score";

function readHighScore(): number {
  try {
    const raw = window.localStorage.getItem(HIGH_SCORE_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeHighScore(score: number) {
  try {
    window.localStorage.setItem(HIGH_SCORE_KEY, String(score));
  } catch {
    // Blocked storage only loses the record between visits.
  }
}

function paletteOf(el: HTMLElement) {
  const css = getComputedStyle(el);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    ink: read("--color-foreground", "#e8e8ee"),
    accent: read("--color-os-accent", "#a8d3de"),
    grey: read("--color-os-grey", "#bababa"),
  };
}

function draw(ctx: CanvasRenderingContext2D, state: GameState, palette: ReturnType<typeof paletteOf>) {
  ctx.clearRect(0, 0, STAGE.width, STAGE.height);

  ctx.strokeStyle = palette.grey;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y + 1);
  ctx.lineTo(STAGE.width, GROUND_Y + 1);
  ctx.stroke();

  ctx.fillStyle = palette.ink;
  for (const o of state.obstacles) {
    ctx.beginPath();
    ctx.roundRect(o.x, GROUND_Y - o.height, o.width, o.height, 4);
    ctx.fill();
  }

  const top = GROUND_Y - RUNNER.height - state.runnerY;
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.roundRect(RUNNER.x, top, RUNNER.width, RUNNER.height, 6);
  ctx.fill();
  ctx.fillStyle = palette.ink;
  ctx.beginPath();
  ctx.arc(RUNNER.x + RUNNER.width - 7, top + 8, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

// The Chrome offline runner, in the dali.os palette. Space, the up arrow, or
// a tap jumps; the same input restarts after a hit.
export function DinoGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(createGame());
  const [status, setStatus] = useState<GameState["status"]>("ready");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);

  useEffect(() => {
    setHighScore(readHighScore());
  }, []);

  const input = useCallback(() => {
    stateRef.current = press(stateRef.current);
    setStatus(stateRef.current.status);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const palette = paletteOf(canvas);
    let last = performance.now();
    let frame = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const before = stateRef.current;
      const after = step(before, dt);
      stateRef.current = after;
      draw(ctx, after, palette);
      if (after.score !== before.score) setScore(after.score);
      if (after.status !== before.status) {
        setStatus(after.status);
        if (after.status === "over") {
          setHighScore((h) => {
            const best = Math.max(h, after.score);
            if (best > h) writeHighScore(best);
            return best;
          });
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.code !== "ArrowUp") return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      e.preventDefault();
      input();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [input]);

  const hint =
    status === "ready"
      ? "Press space or tap to run while you wait."
      : status === "over"
        ? "Hit. Press space or tap to go again."
        : "Space or tap to jump.";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-os-grey">{hint}</p>
        <p className="text-sm tabular-nums text-foreground" aria-live="polite">
          {score}
          {highScore > 0 && <span className="text-os-grey"> · best {highScore}</span>}
        </p>
      </div>
      <canvas
        ref={canvasRef}
        width={STAGE.width}
        height={STAGE.height}
        role="img"
        aria-label="A runner game. Press space to jump over the blocks."
        onPointerDown={input}
        className="w-full max-w-2xl cursor-pointer select-none touch-none rounded-os-item bg-os-well"
      />
    </div>
  );
}
