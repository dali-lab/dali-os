import type { Route } from "./+types/api.custom-emoji";
import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { prisma } from "~/lib/db.server";
import { checkRateLimit } from "~/lib/rate-limit";
import { CUSTOM_EMOJI_NAME } from "~/lib/reactions";
import { listCustomEmoji } from "~/lib/reactions.server";
import { getUserRoles } from "~/lib/roles";

// The action stores whatever key the client names, so it only accepts the shape
// uploadFileToS3 builds for the two files the picker can produce.
const EMOJI_KEY = /^uploads\/custom-emoji\/[0-9a-f-]{36}-emoji\.(png|gif)$/;

async function requireEmojiViewer(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { denied: auth.response } as const;
  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isLabMember && !roles.isCore) {
    return { denied: Response.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  return { viewer: { userId: auth.user.sub, core: roles.isCore } } as const;
}

export async function loader({ request }: Route.LoaderArgs) {
  const { viewer, denied } = await requireEmojiViewer(request);
  if (denied) return denied;
  return Response.json({ emoji: await listCustomEmoji(viewer) });
}

export async function action({ request }: Route.ActionArgs) {
  const { viewer, denied } = await requireEmojiViewer(request);
  if (denied) return denied;
  const limited = checkRateLimit(
    request,
    { max: 30, windowMs: 60_000 },
    `custom-emoji:${viewer.userId}`,
  );
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  if (body?.intent === "add") {
    const name = typeof body.name === "string" ? body.name : "";
    const imageKey = typeof body.imageKey === "string" ? body.imageKey : "";
    if (!CUSTOM_EMOJI_NAME.test(name)) {
      return Response.json(
        { error: "Use 2 to 48 lowercase letters, numbers, dashes or underscores." },
        { status: 400 },
      );
    }
    if (!EMOJI_KEY.test(imageKey)) {
      return Response.json({ error: "That image could not be used." }, { status: 400 });
    }
    try {
      const created = await prisma.customEmoji.create({
        data: { name, imageKey, addedById: viewer.userId },
        select: { id: true },
      });
      await logAuditEvent({
        action: "custom_emoji.add",
        userId: viewer.userId,
        targetId: created.id,
        metadata: { name },
        request,
      });
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
      return Response.json({ error: "That name is taken." }, { status: 409 });
    }
    return Response.json({ emoji: await listCustomEmoji(viewer) });
  }

  if (body?.intent === "delete") {
    const id = typeof body.id === "string" ? body.id : "";
    const { count } = await prisma.customEmoji.updateMany({
      where: { id, deletedAt: null, ...(viewer.core ? {} : { addedById: viewer.userId }) },
      data: { deletedAt: new Date() },
    });
    if (count === 0) return Response.json({ error: "Not found" }, { status: 404 });
    await logAuditEvent({
      action: "custom_emoji.delete",
      userId: viewer.userId,
      targetId: id,
      request,
    });
    return Response.json({ emoji: await listCustomEmoji(viewer) });
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}
