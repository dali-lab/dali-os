import type { Route } from "./+types/api.my-interview.cancel";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { safeJson } from "~/lib/safe-json";

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await safeJson<{ domainApplicationId?: string }>(request);
  if (body instanceof Response) return withCors(request, body);
  const { domainApplicationId } = body;

  if (!domainApplicationId) {
    return withCors(request, Response.json({ error: "domainApplicationId is required" }, { status: 400 }));
  }

  const interview = await prisma.interview.findFirst({
    where: {
      domainApplicationId,
      domainApplication: { application: { userId: auth.user.sub } },
      status: "Scheduled",
    },
  });

  if (!interview) {
    return withCors(request, Response.json({ error: "No active interview found" }, { status: 404 }));
  }

  const updated = await prisma.interview.update({
    where: { id: interview.id },
    data: { status: "CancelledByApplicant" },
  });

  return withCors(request, Response.json(updated));
}
