import type { Route } from "./+types/api.decisions.$id.release";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!(await isHiringLead(auth.user.sub))) {
    return Response.json({ error: "Only hiring leads can release decisions" }, { status: 403 });
  }

  const member = await prisma.dALIMember.findFirst({ where: { userId: auth.user.sub } });
  if (!member) {
    return Response.json({ error: "Not a DALI member" }, { status: 403 });
  }

  const decision = await prisma.decision.findUnique({ where: { id: params.id } });
  if (!decision) {
    return Response.json({ error: "Decision not found" }, { status: 404 });
  }
  if (decision.stage !== "Final") {
    return Response.json({ error: "Only Final decisions can be released" }, { status: 409 });
  }

  const released = await prisma.decision.create({
    data: {
      domainApplicationId: decision.domainApplicationId,
      type: decision.type,
      stage: "Released",
      madeById: member.id,
      notes: decision.notes,
      waitlistRank: decision.waitlistRank,
    },
  });

  return Response.json(released, { status: 201 });
}
