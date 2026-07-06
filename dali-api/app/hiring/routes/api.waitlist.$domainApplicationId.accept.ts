import type { Route } from "./+types/api.waitlist.$domainApplicationId.accept";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { acceptFromWaitlist } from "~/hiring/lib/waitlist.server";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await acceptFromWaitlist({
    domainApplicationId: params.domainApplicationId,
    actorId: auth.user.sub,
    request,
  });

  if (!result.ok) {
    const status =
      result.reason === "not-found"
        ? 404
        : result.reason === "no-email-binding"
          ? 409
          : 409;
    return Response.json({ error: result.message }, { status });
  }
  return Response.json(result, { status: 201 });
}
