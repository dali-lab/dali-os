import type { Route } from "./+types/api.delibs.$id.presence";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles, hasCycleAccess } from "~/lib/roles";
import { safeJson } from "~/lib/safe-json";
import type { DelibsParticipantRole } from "~/generated/prisma/enums";

async function deriveRole(
  memberId: string,
  cycleId: string,
  domainId: string,
  flags: { isHiringLead: boolean; isDomainLead: boolean },
): Promise<DelibsParticipantRole | null> {
  if (flags.isHiringLead) return "HiringLead";
  if (flags.isDomainLead) {
    const lead = await prisma.domainLeadAssignment.findFirst({
      where: { memberId, domainId },
      select: { id: true },
    });
    if (lead) return "DomainLead";
  }
  const reviewer = await prisma.cycleReviewer.findFirst({
    where: { daliMemberId: memberId, applicationCycleId: cycleId, domainId },
    select: { id: true },
  });
  if (reviewer) return "Reviewer";
  return null;
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const session = await prisma.delibsSession.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      domainId: true,
      applicationCycleId: true,
      status: true,
    },
  });
  if (!session) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (!(await hasCycleAccess(auth.user.sub, session.applicationCycleId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const roles = await getUserRoles(auth.user.sub);
  if (!roles.memberId) {
    return Response.json({ error: "Not a DALI member" }, { status: 403 });
  }
  const memberId = roles.memberId;

  const body = await safeJson<Record<string, unknown>>(request);
  if (body instanceof Response) return body;

  const intent = body.intent;
  if (intent !== "join" && intent !== "leave") {
    return Response.json({ error: "Invalid intent" }, { status: 400 });
  }

  if (intent === "join") {
    if (session.status === "Closed") {
      return Response.json({ error: "Session is closed" }, { status: 409 });
    }

    const role = await deriveRole(memberId, session.applicationCycleId, session.domainId, {
      isHiringLead: roles.isHiringLead,
      isDomainLead: roles.isDomainLead,
    });
    if (!role) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.$transaction(
      async (tx) => {
        const open = await tx.delibsSessionParticipant.findFirst({
          where: {
            delibsSessionId: session.id,
            daliMemberId: memberId,
            leftAt: null,
          },
          select: { id: true },
        });
        if (open) return;
        await tx.delibsSessionParticipant.create({
          data: {
            delibsSessionId: session.id,
            daliMemberId: memberId,
            role,
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
  } else {
    await prisma.delibsSessionParticipant.updateMany({
      where: {
        delibsSessionId: session.id,
        daliMemberId: memberId,
        leftAt: null,
      },
      data: { leftAt: new Date() },
    });
  }

  const participants = await prisma.delibsSessionParticipant.findMany({
    where: { delibsSessionId: session.id },
    orderBy: { joinedAt: "asc" },
    include: {
      daliMember: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return Response.json({ participants });
}
