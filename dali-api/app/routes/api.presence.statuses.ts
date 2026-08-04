import type { Route } from "./+types/api.presence.statuses";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { derivePresenceState, type AvatarStatus } from "~/lib/presence";

const MAX_IDS = 200;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const rawIds = url.searchParams.get("ids") ?? "";
  const ids = rawIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  if (ids.length === 0) {
    return Response.json({} as Record<string, AvatarStatus>);
  }

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, lastActiveAt: true, hideActivity: true },
  });

  const now = new Date();
  const result: Record<string, AvatarStatus> = {};
  for (const u of users) {
    const state = derivePresenceState(u.lastActiveAt, now, u.hideActivity);
    result[u.id] = {
      state,
      // Never expose the raw timestamp when the user wants to appear away.
      lastActiveAt: u.hideActivity ? null : (u.lastActiveAt?.toISOString() ?? null),
    };
  }

  return Response.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
