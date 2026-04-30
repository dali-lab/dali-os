import type { Route } from "./+types/api.domain-applications.$id.decisions";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead, hasCycleAccess } from "~/lib/roles";
import { parseJson } from "~/lib/validate";

const DecisionSchema = z.object({
  type: z.enum(["Rejected", "InvitedToInterview", "Accepted", "Waitlisted"]),
  stage: z.enum(["Draft", "Final", "Released"]),
  notes: z.string().max(5_000).optional(),
  waitlistRank: z.number().int().min(0).max(10_000).optional(),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const domainApp = await prisma.domainApplication.findUnique({
    where: { id: params.id },
    select: { application: { select: { applicationCycleId: true } } },
  });
  if (!domainApp) return withAuth(auth, Response.json({ error: "Not found" }, { status: 404 }));
  if (!(await hasCycleAccess(auth.user.sub, domainApp.application.applicationCycleId)))
    return withAuth(auth, Response.json({ error: "Forbidden" }, { status: 403 }));

  const decisions = await prisma.decision.findMany({
    where: { domainApplicationId: params.id },
    orderBy: { createdAt: "desc" },
    include: {
      madeBy: { select: { firstName: true, lastName: true } },
      parent: {
        include: { madeBy: { select: { firstName: true, lastName: true } } },
      },
    },
  });

  return withAuth(auth, Response.json(decisions));
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return withAuth(auth, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, DecisionSchema);
  if (body instanceof Response) return withAuth(auth, body);
  const { type, stage, notes, waitlistRank } = body;

  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
  });
  if (!member) {
    return withAuth(auth, Response.json({ error: "Not a DALI member" }, { status: 403 }));
  }

  // Stage-based authorization:
  // Draft/Final = domain lead or hiring lead
  // Released = hiring lead only
  if (stage === "Released") {
    if (!(await isHiringLead(auth.user.sub))) {
      return withAuth(auth, Response.json({ error: "Only hiring leads can release decisions" }, { status: 403 }));
    }
  } else {
    const hiringLead = await isHiringLead(auth.user.sub);
    const domainLead = await isDomainLead(auth.user.sub);
    if (!hiringLead && !domainLead) {
      return withAuth(auth, Response.json({ error: "Forbidden" }, { status: 403 }));
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

  return withAuth(auth, Response.json(decision, { status: 201 }));
}
