import type { Route } from "./+types/api.waitlist.reorder";
import { z } from "zod";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { isAdminOnlyCycle } from "~/hiring/lib/applicant-groups";
import { reorderWaitlist } from "~/hiring/lib/waitlist.server";

const ReorderSchema = z.object({
  domainId: z.string().min(1),
  order: z.array(z.string().min(1)).min(1).max(500),
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

  const body = await parseJson(request, ReorderSchema);
  if (body instanceof Response) return body;

  const result = await reorderWaitlist({
    domainId: body.domainId,
    order: body.order,
    // Same visibility as the waitlists.tsx loader.
    visible: (e) => roles.isAdmin || !isAdminOnlyCycle(e.cycle.applicants),
    actorId: auth.user.sub,
    request,
  });

  if (!result.ok) {
    return Response.json({ error: result.message }, { status: 409 });
  }
  return Response.json(result);
}
