import type { Route } from "./+types/api.cycles.$cycleId.interviewers";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead, hasCycleAccess } from "~/lib/roles";
import { parseJson } from "~/lib/validate";

const CreateInterviewerSchema = z.object({
  daliMemberId: z.string().min(1).max(100),
  domainId: z.string().min(1).max(100),
});

const DeleteInterviewerSchema = z.object({
  interviewerId: z.string().min(1).max(100),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!)))
    return withAuth(auth, Response.json({ error: "Forbidden" }, { status: 403 }));

  const interviewers = await prisma.cycleInterviewer.findMany({
    where: { applicationCycleId: params.cycleId },
    include: {
      daliMember: { select: { firstName: true, lastName: true, daliEmail: true } },
      domain: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return withAuth(auth, Response.json(interviewers));
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const hiringLead = await isHiringLead(auth.user.sub);
  const domainLead = await isDomainLead(auth.user.sub);
  if (!hiringLead && !domainLead) {
    return withAuth(auth, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  if (request.method === "POST") {
    const body = await parseJson(request, CreateInterviewerSchema);
    if (body instanceof Response) return withAuth(auth, body);
    const { daliMemberId, domainId } = body;

    const interviewer = await prisma.cycleInterviewer.create({
      data: {
        daliMemberId,
        applicationCycleId: params.cycleId,
        domainId,
      },
    });

    return withAuth(auth, Response.json(interviewer, { status: 201 }));
  }

  if (request.method === "DELETE") {
    const body = await parseJson(request, DeleteInterviewerSchema);
    if (body instanceof Response) return withAuth(auth, body);
    const { interviewerId } = body;

    // InterviewAssignment FK to CycleInterviewer is non-cascading (audit-bearing).
    // Refuse removal when the interviewer has an Active assignment on a still-Scheduled
    // interview — auto-cancelling those would silently fire applicant-facing emails.
    // Historical (Declined/Replaced) assignments and assignments on Cancelled/Completed
    // interviews are deleted in the same tx so the parent row can go.
    const scheduledActive = await prisma.interviewAssignment.count({
      where: {
        cycleInterviewerId: interviewerId,
        status: "Active",
        interview: { status: "Scheduled" },
      },
    });
    if (scheduledActive > 0) {
      return withAuth(
        auth,
        Response.json(
          {
            error: `This interviewer has ${scheduledActive} scheduled interview${scheduledActive === 1 ? "" : "s"} — reassign or cancel ${scheduledActive === 1 ? "it" : "them"} first.`,
          },
          { status: 409 },
        ),
      );
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.interviewAssignment.deleteMany({
          where: { cycleInterviewerId: interviewerId },
        });
        await tx.cycleInterviewer.delete({
          where: { id: interviewerId },
        });
      });
    } catch (e: any) {
      if (e?.code === "P2025") {
        return withAuth(auth, Response.json({ error: "Interviewer not found" }, { status: 404 }));
      }
      return withAuth(auth, Response.json({ error: "Failed to remove interviewer" }, { status: 500 }));
    }

    return withAuth(auth, Response.json({ deleted: true }));
  }

  return withAuth(auth, Response.json({ error: "Method not allowed" }, { status: 405 }));
}
