import type { Route } from "./+types/api.domain-applications.$id.decisions";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead, hasCycleAccess } from "~/lib/roles";
import { safeJson } from "~/lib/safe-json";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const domainApp = await prisma.domainApplication.findUnique({
    where: { id: params.id },
    select: { application: { select: { applicationCycleId: true } } },
  });
  if (!domainApp) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await hasCycleAccess(auth.user.sub, domainApp.application.applicationCycleId)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const decisions = await prisma.decision.findMany({
    where: { domainApplicationId: params.id },
    orderBy: { createdAt: "desc" },
    include: { madeBy: { select: { firstName: true, lastName: true } } },
  });

  return Response.json(decisions);
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await safeJson<{ type?: string; stage?: string; notes?: string; waitlistRank?: number }>(request);
  if (body instanceof Response) return body;
  const { type, stage, notes, waitlistRank } = body;

  if (!type || !stage) {
    return Response.json({ error: "type and stage are required" }, { status: 400 });
  }

  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
  });
  if (!member) {
    return Response.json({ error: "Not a DALI member" }, { status: 403 });
  }

  // Stage-based authorization:
  // Draft/Final = domain lead or hiring lead
  // Released = hiring lead only
  if (stage === "Released") {
    if (!(await isHiringLead(auth.user.sub))) {
      return Response.json({ error: "Only hiring leads can release decisions" }, { status: 403 });
    }
  } else {
    const hiringLead = await isHiringLead(auth.user.sub);
    const domainLead = await isDomainLead(auth.user.sub);
    if (!hiringLead && !domainLead) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const decision = await prisma.decision.create({
    data: {
      domainApplicationId: params.id,
      type,
      stage,
      madeById: member.id,
      notes: notes ?? null,
      waitlistRank: waitlistRank ?? null,
    },
  });

  return Response.json(decision, { status: 201 });
}
