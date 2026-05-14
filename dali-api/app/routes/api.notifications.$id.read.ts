import type { Route } from "./+types/api.notifications.$id.read";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const id = params.id!;
  const existing = await prisma.notification.findUnique({
    where: { id },
    select: { recipientUserId: true, readAt: true },
  });
  if (!existing) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }
  if (existing.recipientUserId !== auth.user.sub) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  if (existing.readAt) {
    return withCors(request, Response.json({ ok: true }));
  }
  await prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
  });
  return withCors(request, Response.json({ ok: true }));
}
