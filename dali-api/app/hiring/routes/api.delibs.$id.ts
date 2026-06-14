import type { Route } from "./+types/api.delibs.$id";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, requireCoreOrDomainLead, requireMemberSession, forbidden } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

const DelibsActionSchema = z.object({
  intent: z.enum(["close"]),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const session = await prisma.delibsSession.findUnique({
    where: { id: params.id },
  });

  if (!session) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (!(await hasCycleAccess(auth.user.sub, session.applicationCycleId)))
    return forbidden(request);

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    session.applicationCycleId,
  );
  if (gate) return gate;

  return Response.json(session);
}

export async function action({ request, params }: Route.ActionArgs) {
  const roleGate = await requireCoreOrDomainLead(request);
  if (!roleGate.ok) return roleGate.response;
  const auth = roleGate.auth;

  const sessionForGate = await prisma.delibsSession.findUnique({
    where: { id: params.id },
    select: { applicationCycleId: true },
  });
  if (!sessionForGate) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    sessionForGate.applicationCycleId,
  );
  if (gate) return gate;

  if (request.method === "POST") {
    const body = await parseJson(request, DelibsActionSchema);
    if (body instanceof Response) return body;
    const { intent } = body;

    if (intent === "close") {
      const member = await prisma.dALIMember.findUnique({
        where: { userId: auth.user.sub },
      });
      if (!member) {
        return Response.json({ error: "Not a DALI member" }, { status: 403 });
      }

      const session = await prisma.delibsSession.findUnique({
        where: { id: params.id },
      });
      if (!session) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }

      const columnOrder = session.columnOrder as Record<string, string[]>;
      const decisions: Array<{
        domainApplicationId: string;
        type: string;
        waitlistRank: number | null;
      }> = [];

      if (session.type === "Initial") {
        for (const id of columnOrder["Interview"] ?? []) {
          decisions.push({ domainApplicationId: id, type: "InvitedToInterview", waitlistRank: null });
        }
        for (const id of columnOrder["Reject"] ?? []) {
          decisions.push({ domainApplicationId: id, type: "Rejected", waitlistRank: null });
        }
      } else {
        for (const id of columnOrder["Accept"] ?? []) {
          decisions.push({ domainApplicationId: id, type: "Accepted", waitlistRank: null });
        }
        for (const [rank, id] of (columnOrder["Waitlist"] ?? []).entries()) {
          decisions.push({ domainApplicationId: id, type: "Waitlisted", waitlistRank: rank + 1 });
        }
        for (const id of columnOrder["Reject"] ?? []) {
          decisions.push({ domainApplicationId: id, type: "Rejected", waitlistRank: null });
        }
      }

      await prisma.$transaction(async (tx) => {
        for (const d of decisions) {
          await tx.decision.create({
            data: {
              domainApplicationId: d.domainApplicationId,
              type: d.type as any,
              stage: "Draft",
              madeById: auth.user.sub,
              waitlistRank: d.waitlistRank,
            },
          });
        }

        await tx.delibsSession.update({
          where: { id: params.id },
          data: { status: "Closed" },
        });
      });

      return Response.json({ closed: true, decisionsCreated: decisions.length });
    }
  }

  return Response.json({ error: "Invalid request" }, { status: 400 });
}
