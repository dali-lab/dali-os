import type { Route } from "./+types/api.cycles.$cycleId.book-interview";
import { prisma } from "~/lib/db";
import { withCors, handlePreflight } from "~/lib/cors";
import { assignInterviewers } from "~/lib/scheduling";

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await request.json();
  const { slotStart, slotEnd, domainApplicationId } = body;

  if (!slotStart || !slotEnd || !domainApplicationId) {
    return withCors(request, Response.json({ error: "slotStart, slotEnd, and domainApplicationId required" }, { status: 400 }));
  }

  const domainApplication = await prisma.domainApplication.findUnique({
    where: { id: domainApplicationId },
    include: { challengeVersion: true },
  });

  if (!domainApplication) {
    return withCors(request, Response.json({ error: "DomainApplication not found" }, { status: 404 }));
  }

  const applicantDomainIds = [domainApplication.challengeVersion.domainId];

  try {
    const interview = await assignInterviewers(
      params.cycleId!,
      domainApplicationId,
      applicantDomainIds,
      new Date(slotStart),
      new Date(slotEnd),
    );
    return withCors(request, Response.json(interview, { status: 201 }));
  } catch (err: any) {
    return withCors(request, Response.json({ error: err.message }, { status: 409 }));
  }
}
