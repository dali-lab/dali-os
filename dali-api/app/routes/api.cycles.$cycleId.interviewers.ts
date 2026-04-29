import type { Route } from "./+types/api.cycles.$cycleId.interviewers";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead, hasCycleAccess } from "~/lib/roles";
import { safeJson } from "~/lib/safe-json";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const interviewers = await prisma.cycleInterviewer.findMany({
    where: { applicationCycleId: params.cycleId },
    include: {
      daliMember: { select: { firstName: true, lastName: true, daliEmail: true } },
      domain: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return Response.json(interviewers);
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
    const body = await safeJson<{ daliMemberId?: string; domainId?: string }>(request);
    if (body instanceof Response) return body;
    const { daliMemberId, domainId } = body;

    if (!daliMemberId || !domainId) {
      return Response.json({ error: "daliMemberId and domainId are required" }, { status: 400 });
    }

    const interviewer = await prisma.cycleInterviewer.create({
      data: {
        daliMemberId,
        applicationCycleId: params.cycleId,
        domainId,
      },
    });

    return Response.json(interviewer, { status: 201 });
  }

  if (request.method === "DELETE") {
    const body = await safeJson<{ interviewerId?: string }>(request);
    if (body instanceof Response) return body;
    const { interviewerId } = body;

    if (!interviewerId) {
      return Response.json({ error: "interviewerId is required" }, { status: 400 });
    }

    await prisma.cycleInterviewer.delete({
      where: { id: interviewerId },
    });

    return Response.json({ deleted: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
