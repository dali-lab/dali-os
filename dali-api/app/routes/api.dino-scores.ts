import type { Route } from "./+types/api.dino-scores";
import { requireMemberSession } from "~/lib/auth";
import { MAX_SCORE, readLeaderboard, recordScore } from "~/lib/dino-scores.server";

//   GET  /api/dino-scores  — the top places, plus the caller's own best
//   POST /api/dino-scores  — report a finished run: { score }

function isScore(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_SCORE;
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
  const score = (body as { score?: unknown } | null)?.score;
  if (!isScore(score)) {
    return Response.json({ error: "Invalid score" }, { status: 400 });
  }
  return Response.json(await recordScore(gate.auth.user.sub, { score }));
}
