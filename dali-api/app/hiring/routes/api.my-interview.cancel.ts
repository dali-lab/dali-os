import type { Route } from "./+types/api.my-interview.cancel";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";

const CancelSchema = z.object({
  domainApplicationId: z.string().min(1).max(100),
});

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withAuth(auth, withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 })));
  }

  const body = await parseJson(request, CancelSchema);
  if (body instanceof Response) return withAuth(auth, withCors(request, body));
  const { domainApplicationId } = body;

  const interview = await prisma.interview.findFirst({
    where: {
      domainApplicationId,
      domainApplication: { application: { userId: auth.user.sub } },
      status: "Scheduled",
    },
  });

  if (!interview) {
    return withAuth(auth, withCors(request, Response.json({ error: "No active interview found" }, { status: 404 })));
  }

  const updated = await prisma.interview.update({
    where: { id: interview.id },
    data: { status: "CancelledByApplicant" },
  });

  return withAuth(auth, withCors(request, Response.json(updated)));
}
