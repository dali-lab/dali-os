import type { Route } from "./+types/api.applications.$id.withdraw";
import { requireAuth } from "~/lib/auth";
import { isApplicantOf } from "~/education/lib/access";
import { decide } from "~/lib/education/decisions";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isApplicantOf(auth.user.sub, params.id!))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await decide({
    applicationId: params.id!,
    action: "Withdraw",
    actorUserId: auth.user.sub,
  });
  return Response.json(result);
}
