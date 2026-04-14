import type { Route } from "./+types/api.my-interview.reschedule";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { assignReviewers } from "~/lib/scheduling";

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

  // Find current interview
  const current = await prisma.interview.findFirst({
    where: {
      application: { userId: auth.user.sub },
      status: { in: ["Scheduled", "NeedsReassignment"] },
    },
    include: {
      application: {
        include: { domainApplications: { include: { challengeVersion: true } } },
      },
    },
  });

  if (!current) {
    return withCors(request, Response.json({ error: "No active interview found" }, { status: 404 }));
  }

  const applicantDomainIds = current.application.domainApplications.map(
    (da) => da.challengeVersion.domainId,
  );

  // Cancel old interview, book new one
  await prisma.interview.update({
    where: { id: current.id },
    data: { status: "CancelledByApplicant" },
  });

  try {
    const newInterview = await assignReviewers(
      current.applicationCycleId,
      current.applicationId,
      applicantDomainIds,
      new Date(newStart),
      new Date(newEnd),
    );
    return withCors(request, Response.json(newInterview, { status: 201 }));
  } catch (err: any) {
    // Rollback: restore old interview if new booking fails
    await prisma.interview.update({
      where: { id: current.id },
      data: { status: "Scheduled" },
    });
    return withCors(request, Response.json({ error: err.message }, { status: 409 }));
  }
}
