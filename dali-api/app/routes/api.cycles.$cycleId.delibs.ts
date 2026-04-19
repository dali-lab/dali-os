import type { Route } from "./+types/api.cycles.$cycleId.delibs";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead, hasCycleAccess } from "~/lib/roles";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const sessions = await prisma.delibsSession.findMany({
    where: { applicationCycleId: params.cycleId },
    orderBy: { createdAt: "desc" },
  });

  return Response.json(sessions);
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const hiringLead = await isHiringLead(auth.user.sub);
  const domainLead = await isDomainLead(auth.user.sub);
  if (!hiringLead && !domainLead) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
  });
  if (!member) {
    return Response.json({ error: "Not a DALI member" }, { status: 403 });
  }

  const body = await request.json();
  const { domainId, type } = body;

  if (!domainId || !type) {
    return Response.json({ error: "domainId and type are required" }, { status: 400 });
  }

  // Upsert: reopen if previously closed, create if new
  const session = await prisma.delibsSession.upsert({
    where: {
      domainId_applicationCycleId_type: {
        domainId,
        applicationCycleId: params.cycleId,
        type,
      },
    },
    create: {
      domainId,
      applicationCycleId: params.cycleId,
      type,
      status: "Active",
      openedById: member.id,
    },
    update: {
      status: "Active",
    },
  });

  return Response.json(session, { status: 201 });
}
