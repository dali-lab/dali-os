import type { Route } from "./+types/api.assignments.$id.submit";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";

// Student creates/updates an EducationSubmission row. The submission body
// lives in a collab doc named education-submission:{id}:content; this
// endpoint just maintains the row + final submitted timestamp + file list.

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const assignmentId = params.id!;
  const assignment = await prisma.educationAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      offeringId: true,
      session: { select: { offeringId: true } },
    },
  });
  if (!assignment) return Response.json({ error: "Not found" }, { status: 404 });

  const offeringId = assignment.offeringId ?? assignment.session?.offeringId;
  if (!offeringId) {
    return Response.json({ error: "Assignment not linked to offering" }, { status: 500 });
  }

  // Student must have an Approved application for the parent offering.
  const application = await prisma.educationApplication.findUnique({
    where: {
      applicantUserId_offeringId: {
        applicantUserId: auth.user.sub,
        offeringId,
      },
    },
    select: { id: true, status: true },
  });
  if (!application || application.status !== "Approved") {
    return Response.json({ error: "Not enrolled" }, { status: 403 });
  }

  const body = (await request.json()) as {
    files?: Array<{ name: string; key: string }>;
    finalize?: boolean;
  };

  const submission = await prisma.educationSubmission.upsert({
    where: {
      assignmentId_studentId: { assignmentId, studentId: auth.user.sub },
    },
    create: {
      assignmentId,
      studentId: auth.user.sub,
      educationApplicationId: application.id,
      files: body.files ?? undefined,
      submittedAt: body.finalize ? new Date() : null,
    },
    update: {
      files: body.files ?? undefined,
      submittedAt: body.finalize ? new Date() : undefined,
    },
  });
  return Response.json({ submission }, { status: 201 });
}
