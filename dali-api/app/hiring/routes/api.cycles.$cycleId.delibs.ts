import type { Route } from "./+types/api.cycles.$cycleId.delibs";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isDomainLead, hasCycleAccess } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

const CreateDelibsSchema = z.object({
  domainId: z.string().min(1).max(100),
  type: z.enum(["Initial", "Final"]),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const gate = await requireApiSignedOrForbidden(auth.user.sub, params.cycleId!);
  if (gate) return gate;

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

  const hiringLead = await isCore(auth.user.sub);
  const domainLead = await isDomainLead(auth.user.sub);
  if (!hiringLead && !domainLead) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
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
  const { domainId, type } = body;

  // InternToFull cycles skip the Initial → interview → Final pipeline. There's
  // only one round of deliberation (review → decision), so we hard-block
  // anyone trying to open an Initial session on these cycles.
  const cycleType = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: params.cycleId },
    select: { cycleType: true },
  });
  if (cycleType.cycleType === "InternToFull" && type === "Initial") {
    return Response.json(
      { error: "InternToFull cycles only run a single Final deliberation round." },
      { status: 400 },
    );
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
      openedById: auth.user.sub,
    },
    update: {
      status: "Active",
    },
  });

  return Response.json(session, { status: 201 });
}
