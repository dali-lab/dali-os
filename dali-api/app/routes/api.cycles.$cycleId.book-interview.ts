import type { Route } from "./+types/api.cycles.$cycleId.book-interview";
import { prisma } from "~/lib/db";
import { withCors, handlePreflight } from "~/lib/cors";
import { assignReviewers } from "~/lib/scheduling";

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await request.json();
  const { slotStart, slotEnd, applicationId } = body;

  if (!slotStart || !slotEnd || !applicationId) {
    return withCors(request, Response.json({ error: "slotStart, slotEnd, and applicationId required" }, { status: 400 }));
  }

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { domainApplications: { include: { challengeVersion: true } } },
  });

  if (!application) {
    return withCors(request, Response.json({ error: "Application not found" }, { status: 404 }));
  }

  const applicantDomainIds = application.domainApplications.map(
    (da) => da.challengeVersion.domainId,
  );

  try {
    const interview = await assignReviewers(
      params.cycleId,
      applicationId,
      applicantDomainIds,
      new Date(slotStart),
      new Date(slotEnd),
    );
    return withCors(request, Response.json(interview, { status: 201 }));
  } catch (err: any) {
    return withCors(request, Response.json({ error: err.message }, { status: 409 }));
  }
}
