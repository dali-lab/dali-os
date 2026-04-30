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

    await prisma.cycleInterviewer.delete({
      where: { id: interviewerId },
    });

    return withAuth(auth, Response.json({ deleted: true }));
  }

  return withAuth(auth, Response.json({ error: "Method not allowed" }, { status: 405 }));
}
