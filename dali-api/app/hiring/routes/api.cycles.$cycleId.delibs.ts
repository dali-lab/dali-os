import type { Route } from "./+types/api.cycles.$cycleId.delibs";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, requireCoreOrDomainLead, forbidden } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
import { idSchema, parseJson } from "~/lib/validate";
import { findRound } from "~/hiring/lib/cycle-timeline";
import { loadCycleTimeline } from "~/hiring/lib/cycle-timeline.server";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

const CreateDelibsSchema = z.object({
  domainId: idSchema,
  // A delib round in the cycle's timeline.
  roundId: z.string().min(1).max(64),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!)))
    return forbidden(request);

  const gate = await requireApiSignedOrForbidden(auth.user.sub, params.cycleId!);
  if (gate) return gate;

  const sessions = await prisma.delibsSession.findMany({
    where: { applicationCycleId: params.cycleId },
    orderBy: { createdAt: "desc" },
  });

  return Response.json(sessions);
}

export async function action({ request, params }: Route.ActionArgs) {
  const roleGate = await requireCoreOrDomainLead(request);
  if (!roleGate.ok) return roleGate.response;
  const auth = roleGate.auth;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const gate = await requireApiSignedOrForbidden(auth.user.sub, params.cycleId!);
  if (gate) return gate;

  const member = await prisma.dALIMember.findUnique({
    where: { userId: auth.user.sub },
  });
  if (!member) {
    return Response.json({ error: "Not a DALI member" }, { status: 403 });
  }

  const body = await parseJson(request, CreateDelibsSchema);
  if (body instanceof Response) return body;
  const { domainId, roundId } = body;

  if (!findRound(await loadCycleTimeline(params.cycleId!), roundId)) {
    return Response.json({ error: "That delib round isn't in this cycle's timeline." }, { status: 400 });
  }

  // Upsert: reopen if previously closed, create if new
  const session = await prisma.delibsSession.upsert({
    where: {
      domainId_applicationCycleId_roundId: {
        domainId,
        applicationCycleId: params.cycleId,
        roundId,
      },
    },
    create: {
      domainId,
      applicationCycleId: params.cycleId,
      roundId,
      status: "Active",
      openedById: auth.user.sub,
    },
    update: {
      status: "Active",
    },
  });

  return Response.json(session, { status: 201 });
}
