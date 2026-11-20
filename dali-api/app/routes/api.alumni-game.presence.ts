import type { Route } from "./+types/api.alumni-game.presence";
import { requireMemberSession } from "~/lib/auth";
import { heartbeat, leave } from "~/alumni/lib/alumni-presence.server";
import { isLabServerId } from "~/components/alumni-game/servers";
import { isAvatarConfig } from "~/components/alumni-game/pixel-avatar";
import { WORLD } from "~/components/alumni-game/lab-data";

export async function action({ request }: Route.ActionArgs) {
  const session = await requireMemberSession(request);
  if (!session.ok) return session.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const userId = session.auth.user.sub;

  const body = (await request.json().catch(() => null)) as {
    intent?: unknown;
    server?: unknown;
    avatar?: unknown;
    x?: unknown;
    y?: unknown;
  } | null;

  if (body?.intent === "leave") {
    leave(userId);
    return Response.json({ ok: true });
  }

  if (
    !body ||
    !isLabServerId(body.server) ||
    !isAvatarConfig(body.avatar) ||
    typeof body.x !== "number" ||
    typeof body.y !== "number" ||
    !Number.isFinite(body.x) ||
    !Number.isFinite(body.y)
  ) {
    return Response.json({ error: "Invalid heartbeat" }, { status: 400 });
  }

  const result = heartbeat(body.server, {
    userId,
    name: session.auth.user.firstName ?? "",
    avatar: body.avatar,
    x: Math.min(Math.max(body.x, 0), WORLD.width),
    y: Math.min(Math.max(body.y, 0), WORLD.height),
  });
  if (!result.ok) {
    return Response.json({ error: "full", counts: result.counts }, { status: 409 });
  }
  return Response.json({
    ok: true,
    counts: result.counts,
    players: result.players.map((p) => ({
      id: p.userId,
      name: p.name,
      avatar: p.avatar,
      x: p.x,
      y: p.y,
    })),
  });
}
