import type { Route } from "./+types/api.cycles.$cycleId.interviewers";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, requireCoreOrDomainLead, forbidden } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
import { interviewerCalendars } from "~/hiring/lib/interview-availability.server";
import { idSchema, parseJson } from "~/lib/validate";

const CreateInterviewerSchema = z.object({
  userId: idSchema,
  domainId: idSchema,
});

const DeleteInterviewerSchema = z.object({
  interviewerId: idSchema,
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!)))
    return forbidden(request);

  const interviewers = await prisma.cycleInterviewer.findMany({
    where: { applicationCycleId: params.cycleId },
    include: {
      user: { select: { firstName: true, lastName: true, daliEmail: true } },
      domain: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Free time comes from each interviewer's DALI OS calendar inside the
  // interview window (none until the window is set).
  const config = await prisma.interviewConfig.findUnique({
    where: { applicationCycleId: params.cycleId },
  });
  const calendars = config
    ? await interviewerCalendars(interviewers.map((i) => i.userId), config)
    : new Map();
  const withStats = interviewers.map((i) => {
    const cal = calendars.get(i.userId)
    const blocks = cal?.available ?? [];
    const totalMs = blocks.reduce(
      (sum: number, b: { startTime: Date; endTime: Date }) => sum + (b.endTime.getTime() - b.startTime.getTime()),
      0,
    );
    return {
      ...i,
      availabilityBlocks: blocks,
      availabilityBlockCount: blocks.length,
      availabilityHours: totalMs / (1000 * 60 * 60),
      hasCalendar: cal?.hasCalendar ?? false,
      hasWorkingHours: cal?.hasWorkingHours ?? false,
    };
  });

  return Response.json(withStats);
}

export async function action({ request, params }: Route.ActionArgs) {
  const gate = await requireCoreOrDomainLead(request);
  if (!gate.ok) return gate.response;

  if (request.method === "POST") {
    const body = await parseJson(request, CreateInterviewerSchema);
    if (body instanceof Response) return body;
    const { userId, domainId } = body;

    const interviewer = await prisma.cycleInterviewer.create({
      data: {
        userId,
        applicationCycleId: params.cycleId,
        domainId,
      },
    });

    return Response.json(interviewer, { status: 201 });
  }

  if (request.method === "DELETE") {
    const body = await parseJson(request, DeleteInterviewerSchema);
    if (body instanceof Response) return body;
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
      return Response.json(
          {
            error: `This interviewer has ${scheduledActive} scheduled interview${scheduledActive === 1 ? "" : "s"} — reassign or cancel ${scheduledActive === 1 ? "it" : "them"} first.`,
          },
          { status: 409 },
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
        return Response.json({ error: "Interviewer not found" }, { status: 404 });
      }
      return Response.json({ error: "Failed to remove interviewer" }, { status: 500 });
    }

    return Response.json({ deleted: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
