import type { Route } from "./+types/api.alumni-game.avatar";
import { prisma } from "~/lib/db.server";
import { requireMemberSession } from "~/lib/auth";
import { isAvatarConfig } from "~/components/alumni-game/pixel-avatar";

export async function action({ request }: Route.ActionArgs) {
  const session = await requireMemberSession(request);
  if (!session.ok) return session.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  if (!isAvatarConfig(body)) {
    return Response.json({ error: "Invalid avatar" }, { status: 400 });
  }

  const userId = session.auth.user.sub;
  const data = {
    skinTone: body.skinTone,
    eyeColor: body.eyeColor,
    hairColor: body.hairColor,
    hairstyle: body.hairstyle,
  };
  await prisma.pixelAvatar.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return Response.json({ ok: true });
}
