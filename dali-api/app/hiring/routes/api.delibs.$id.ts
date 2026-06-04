import type { Route } from "./+types/api.delibs.$id";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isDomainLead, hasCycleAccess } from "~/lib/roles";
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
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    session.applicationCycleId,
  );
  if (gate) return gate;

  return Response.json(session);
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const hiringLead = await isCore(auth.user.sub);
  const domainLead = await isDomainLead(auth.user.sub);
  if (!hiringLead && !domainLead) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

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
          // The partial unique index on (domainApplicationId, stage) WHERE
          // supersededAt IS NULL means we must vacate the slot before
          // inserting the new row. Reopen + reclose with a different column
          // produces this case. Three steps: find prior → mark superseded
          // (frees the slot) → insert new → link supersededById.
          const prior = await tx.decision.findFirst({
            where: {
              domainApplicationId: d.domainApplicationId,
              stage: "Draft",
              supersededAt: null,
            },
            select: { id: true },
          });

          if (prior) {
            await tx.decision.update({
              where: { id: prior.id },
              data: { supersededAt: new Date() },
            });
          }

          const created = await tx.decision.create({
            data: {
              domainApplicationId: d.domainApplicationId,
              type: d.type as any,
              stage: "Draft",
              madeById: auth.user.sub,
              waitlistRank: d.waitlistRank,
            },
          });

          if (prior) {
            await tx.decision.update({
              where: { id: prior.id },
              data: { supersededById: created.id },
            });
          }
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
