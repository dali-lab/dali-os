import type { Route } from "./+types/api.landing.tetris-scores";
import { requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { MAX_SCORE, readLeaderboard, recordScore } from "~/lib/tetris-scores.server";

// The leaderboard for the tetris game on the week 5 ("Build") home landing
// scene.
//
//   GET  /api/landing/tetris-scores  — the top places, plus the caller's own best
//   POST /api/landing/tetris-scores  — report a finished game: { score, lines, level }
//
// The player is whoever is signed in; nobody types a name, so there is no way
// to put a run under someone else's. The numbers themselves come from the
// browser and are taken on trust — see the TetrisScore model.

type Body = { score: number; lines: number; level: number };

/** A plausible finished game. Integers, in range, and level agreeing with lines. */
function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, unknown>;
  const whole = (v: unknown, max: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
  if (!whole(b.score, MAX_SCORE) || !whole(b.lines, 100_000) || !whole(b.level, 10_000)) {
    return false;
  }
  // The engine derives level from lines (floor(lines / 10) + 1). Checking it
  // here costs nothing and rejects the laziest kind of made-up run.
  return b.level === Math.floor((b.lines as number) / 10) + 1;
}

export async function loader({ request }: Route.LoaderArgs) {
  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);
  return withCors(request, Response.json(await readLeaderboard(gate.auth.user.sub)));
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid score" }, { status: 400 }));
  }

  const result = await recordScore(gate.auth.user.sub, {
    score: body.score,
    lines: body.lines,
    level: body.level,
  });
  return withCors(request, Response.json(result));
}
