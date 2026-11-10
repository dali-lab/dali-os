import type { Route } from "./+types/api.desktop-hint.dismiss";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  await prisma.user.update({
    where: { id: auth.user.sub },
    data: { desktopHintDismissedAt: new Date() },
  });

  return Response.json({ ok: true });
}
