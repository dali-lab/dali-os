import type { Route } from "./+types/api.cycles.$cycleId.interviewers";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead, hasCycleAccess } from "~/lib/roles";
import { parseJson } from "~/lib/validate";

const CreateInterviewerSchema = z.object({
  userId: z.string().min(1).max(100),
  domainId: z.string().min(1).max(100),
});

const ApplyReviewersSchema = z.object({
  action: z.literal("applyAllReviewers"),
  domainId: z.string().min(1).max(100),
});

const PostBodySchema = z.union([ApplyReviewersSchema, CreateInterviewerSchema]);

const DeleteInterviewerSchema = z.object({
  interviewerId: z.string().min(1).max(100),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const interviewers = await prisma.cycleInterviewer.findMany({
    where: { applicationCycleId: params.cycleId },
    include: {
      user: { select: { firstName: true, lastName: true, daliEmail: true } },
      domain: { select: { id: true, name: true } },
      availabilityBlocks: { select: { startTime: true, endTime: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const withStats = interviewers.map((i) => {
    const sorted = [...i.availabilityBlocks].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime(),
    );
    const totalMs = sorted.reduce(
      (sum, b) => sum + (b.endTime.getTime() - b.startTime.getTime()),
      0,
    );
    return {
      ...i,
      availabilityBlocks: sorted,
      availabilityBlockCount: sorted.length,
      availabilityHours: totalMs / (1000 * 60 * 60),
    };
  });

  return Response.json(withStats);
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const hiringLead = await isHiringLead(auth.user.sub);
  const domainLead = await isDomainLead(auth.user.sub);
  if (!hiringLead && !domainLead) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (request.method === "POST") {
    const body = await parseJson(request, PostBodySchema);
    if (body instanceof Response) return body;

    if ("action" in body) {
      const { domainId } = body;

      const [reviewers, existingInterviewers] = await Promise.all([
        prisma.cycleReviewer.findMany({
          where: { applicationCycleId: params.cycleId, domainId },
          select: { userId: true },
        }),
        prisma.cycleInterviewer.findMany({
          where: { applicationCycleId: params.cycleId, domainId },
          select: { userId: true },
        }),
      ]);

      const existing = new Set(existingInterviewers.map((i) => i.userId));
      const toCreate = reviewers
        .map((r) => r.userId)
        .filter((userId) => !existing.has(userId));

      if (toCreate.length > 0) {
        await prisma.cycleInterviewer.createMany({
          data: toCreate.map((userId) => ({
            userId,
            applicationCycleId: params.cycleId!,
            domainId,
          })),
          skipDuplicates: true,
        });
      }

      const created = await prisma.cycleInterviewer.findMany({
        where: {
          applicationCycleId: params.cycleId,
          domainId,
          userId: { in: toCreate },
        },
        include: {
          user: { select: { firstName: true, lastName: true, daliEmail: true } },
        },
      });

      return Response.json(
        {
          added: created.length,
          skipped: reviewers.length - created.length,
          interviewers: created,
        },
        { status: 201 },
      );
    }

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
