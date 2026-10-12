import type { Route } from "./+types/api.waitlist.remove-all";
import { z } from "zod";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { isAdminOnlyCycle } from "~/hiring/lib/applicant-groups";
import { listActiveWaitlistEntries, removeFromWaitlist } from "~/hiring/lib/waitlist.server";

const RemoveAllSchema = z.object({
  domainApplicationIds: z.array(z.string().min(1)).min(1).max(500),
});

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isCore) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJson(request, RemoveAllSchema);
  if (body instanceof Response) return body;

  // Same visibility as the waitlists.tsx loader.
  const visible = new Set(
    (await listActiveWaitlistEntries())
      .filter((e) => roles.isAdmin || !isAdminOnlyCycle(e.cycle.applicants))
      .map((e) => e.domainApplicationId),
  );

  // One at a time: each removal re-numbers its domain's ranks.
  let removed = 0;
  let failed = 0;
  for (const domainApplicationId of body.domainApplicationIds) {
    const result = visible.has(domainApplicationId)
      ? await removeFromWaitlist({ domainApplicationId, actorId: auth.user.sub, request })
      : null;
    if (result?.ok) removed += 1;
    else failed += 1;
  }

  if (failed > 0) {
    return Response.json(
      { removed, error: `${failed} could not be removed. The waitlist changed since you loaded it.` },
      { status: 409 },
    );
  }
  return Response.json({ removed });
}
