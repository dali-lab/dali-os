import type { Route } from "./+types/api.domain-applications.$id.reopen-scheduling";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { applicantCancelledInterview } from "~/hiring/lib/domain-application-status";
import { invitedRoundId } from "~/hiring/lib/interview-rounds.server";
import { isWithdrawn } from "~/hiring/lib/application-pipeline-filter";

// CancelledByAdmin isn't a withdrawal, so moving the applicant's cancellation
// there puts them back at "invited" with their history intact.
export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Only hiring leads can reopen scheduling" }, { status: 403 });
  }

  const da = await prisma.domainApplication.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      application: {
        select: {
          applicationCycleId: true,
          statusUpdates: { select: { newStatus: true } },
        },
      },
      interviews: {
        where: { status: { in: ["Scheduled", "Completed", "CancelledByApplicant"] } },
        select: { id: true, status: true, interviewRoundId: true },
      },
    },
  });
  if (!da) {
    return Response.json({ error: "Domain application not found" }, { status: 404 });
  }

  const gate = await requireApiSignedOrForbidden(auth.user.sub, da.application.applicationCycleId);
  if (gate) return gate;

  if (isWithdrawn(da.application.statusUpdates)) {
    return Response.json(
      { error: "This applicant withdrew their whole application." },
      { status: 409 },
    );
  }

  const roundId = await invitedRoundId(da.id);
  if (!roundId) {
    return Response.json({ error: "Applicant isn't currently invited to interview." }, { status: 409 });
  }
  if (!applicantCancelledInterview(da.interviews, roundId)) {
    return Response.json({ error: "Applicant has no cancelled interview to reopen." }, { status: 409 });
  }

  const interviewIds = da.interviews
    .filter((i) => i.interviewRoundId === roundId && i.status === "CancelledByApplicant")
    .map((i) => i.id);

  await prisma.interview.updateMany({
    where: { id: { in: interviewIds }, status: "CancelledByApplicant" },
    data: { status: "CancelledByAdmin" },
  });

  await logAuditEvent({
    action: "interview.reopen-scheduling",
    userId: auth.user.sub,
    targetId: da.id,
    metadata: {
      domainApplicationId: da.id,
      applicationCycleId: da.application.applicationCycleId,
      interviewRoundId: roundId,
      interviewIds,
    },
    request,
  });

  return Response.json({ ok: true });
}
