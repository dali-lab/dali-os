import type { Route } from "./+types/api.landing.tunnel-scores";
import { requireMemberSession } from "~/lib/auth";
import {
  MAX_DURATION_MS,
  MAX_SCORE,
  OBSTACLES,
  RUN_ENDINGS,
  logRun,
  readLeaderboard,
  recordScore,
  type TunnelRunReport,
} from "~/lib/tunnel-scores.server";

//   GET  /api/landing/tunnel-scores  — the top places, plus the caller's own best
//   POST /api/landing/tunnel-scores  — report a run: { score, durationMs?, endedBy?, obstacle? }
// Every run is logged; only a fall can set a best, so leaving a run early never moves the board.

const isWhole = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

const oneOf = <T extends string>(options: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (options as readonly string[]).includes(v);

/** Clients from before the run log send only { score }, which reads as a fall. */
function parseRun(body: unknown): TunnelRunReport | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!isWhole(b.score, MAX_SCORE)) return null;
  if (b.durationMs !== undefined && !isWhole(b.durationMs, MAX_DURATION_MS)) return null;
  if (b.endedBy !== undefined && !oneOf(RUN_ENDINGS, b.endedBy)) return null;
  if (b.obstacle !== undefined && b.obstacle !== null && !oneOf(OBSTACLES, b.obstacle)) return null;
  const endedBy = b.endedBy ?? "fall";
  return {
    score: b.score,
    durationMs: (b.durationMs as number | undefined) ?? null,
    endedBy,
    obstacle: endedBy === "fall" ? ((b.obstacle as TunnelRunReport["obstacle"] | undefined) ?? null) : null,
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const gate = await requireMemberSession(request);
  if (!gate.ok) return gate.response;
  return Response.json(await readLeaderboard(gate.auth.user.sub));
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const gate = await requireMemberSession(request);
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const run = parseRun(body);
  if (!run) {
    return Response.json({ error: "Invalid run" }, { status: 400 });
  }

  const userId = gate.auth.user.sub;
  await logRun(userId, run);
  if (run.endedBy === "quit") {
    return Response.json({ ...(await readLeaderboard(userId)), personalBest: false });
  }
  return Response.json(await recordScore(userId, { score: run.score }));
}
