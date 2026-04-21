import type { Route } from "./+types/api.my-interview.cancel";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const interview = await prisma.interview.findFirst({
    where: {
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
