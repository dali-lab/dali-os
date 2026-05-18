import type { Route } from "./+types/api.offerings.$id.apply";
import { requireAuth } from "~/lib/auth";
import { apply } from "~/lib/education/apply";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as { answers?: Record<string, string> };
  const outcome = await apply({
    offeringId: params.id!,
    applicantUserId: auth.user.sub,
    answers: body.answers ?? {},
  });
  if (!outcome.ok) {
    const status =
      outcome.error.kind === "OfferingNotFound" ? 404
      : outcome.error.kind === "MissingRequiredAnswer" ? 400
      : 409;
    return Response.json({ error: outcome.error }, { status });
  }
  return Response.json(outcome.result, { status: 201 });
}
