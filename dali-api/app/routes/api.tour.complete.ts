import type { Route } from "./+types/api.tour.complete";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";

// Mark the launch tour completed for the current member so it isn't auto-shown
// again (server-driven, per-user). Called when the member finishes or dismisses
// the tour. Idempotent. A manual "start tour" button can still re-run it later;
// this only governs the automatic post-onboarding show.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  await prisma.dALIMember.updateMany({
    where: { userId: auth.user.sub, tourCompletedAt: null },
    data: { tourCompletedAt: new Date() },
  });
  return Response.json({ ok: true });
}
