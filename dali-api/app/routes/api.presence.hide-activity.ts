import type { Route } from "./+types/api.presence.hide-activity";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const value = form.get("hideActivity") === "true";

  await prisma.user.update({
    where: { id: auth.user.sub },
    data: { hideActivity: value },
  });

  return Response.json({ ok: true });
}
