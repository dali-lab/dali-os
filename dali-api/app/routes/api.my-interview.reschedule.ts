import type { Route } from "./+types/api.my-interview.reschedule";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { assignInterviewers } from "~/lib/scheduling";

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await request.json();
  const { newStart, newEnd } = body;

  if (!newStart || !newEnd) {
    return withCors(request, Response.json({ error: "newStart and newEnd required" }, { status: 400 }));
  }

  // Cancel old + book new atomically inside a single serializable transaction.
  // If assignInterviewers throws (no free interviewers at the new slot), the
  // whole transaction rolls back and the old interview stays Scheduled.
  try {
    const newInterview = await prisma.$transaction(
      async (tx) => {
        const current = await tx.interview.findFirst({
          where: {
            domainApplication: { application: { userId: auth.user.sub } },
            status: "Scheduled",
          },
          include: {
            domainApplication: {
              include: {
                application: {
                  include: { domainApplications: { include: { challengeVersion: true } } },
                },
              },
            },
          },
        });

        if (!current) {
          throw new Error("__NO_ACTIVE_INTERVIEW__");
        }

        // DomainApplications always attach to a domain-scoped challenge
        // version; filter out any (theoretically impossible) null domainIds.
        const applicantDomainIds = current.domainApplication.application.domainApplications
          .map((da) => da.challengeVersion.domainId)
          .filter((id): id is string => id !== null);

        await tx.interview.update({
          where: { id: current.id },
          data: { status: "CancelledByApplicant" },
        });

        return assignInterviewers(
          current.applicationCycleId,
          current.domainApplicationId,
          applicantDomainIds,
          new Date(newStart),
          new Date(newEnd),
          tx,
        );
      },
      { isolationLevel: "Serializable" },
    );

    return withCors(request, Response.json(newInterview, { status: 201 }));
  } catch (err: any) {
    if (err?.message === "__NO_ACTIVE_INTERVIEW__") {
      return withCors(request, Response.json({ error: "No active interview found" }, { status: 404 }));
    }
    return withCors(request, Response.json({ error: err?.message ?? "Failed to reschedule" }, { status: 409 }));
  }
}
