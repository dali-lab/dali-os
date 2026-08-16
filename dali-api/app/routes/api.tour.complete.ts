import type { Route } from "./+types/api.tour.complete";
import { requireAuth, unauthorized } from "~/lib/auth";
import { dismissGuide } from "~/lib/guide.server";

// Superseded by POST /api/tour/progress with intent=dismiss. Kept so a client
// still running the previous JS bundle mid-deploy can finish its guide instead
// of erroring; it delegates rather than repeating the write.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return unauthorized(request);
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  await dismissGuide(auth.user.sub);
  return Response.json({ ok: true });
}
