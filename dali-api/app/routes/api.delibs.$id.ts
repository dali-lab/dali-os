import type { Route } from "./+types/api.delibs.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead } from "~/lib/roles";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const session = await prisma.delibsSession.findUnique({
    where: { id: params.id },
  });

  if (!session) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(session);
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const hiringLead = await isHiringLead(auth.user.sub);
  const domainLead = await isDomainLead(auth.user.sub);
  if (!hiringLead && !domainLead) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  if (request.method === "PATCH") {
    const { columnOrder } = body;
    if (!columnOrder) {
      return Response.json({ error: "columnOrder is required" }, { status: 400 });
    }

    const updated = await prisma.delibsSession.update({
      where: { id: params.id },
      data: { columnOrder },
    });

    return Response.json(updated);
  }

  if (request.method === "POST") {
    const { intent } = body;

    if (intent === "close") {
      const member = await prisma.dALIMember.findFirst({
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
      const decisions: Array<{ domainApplicationId: string; type: string }> = [];

      if (session.type === "Initial") {
        for (const id of columnOrder["Interview"] ?? []) {
          decisions.push({ domainApplicationId: id, type: "InvitedToInterview" });
        }
        for (const id of columnOrder["Reject"] ?? []) {
          decisions.push({ domainApplicationId: id, type: "Rejected" });
        }
      } else {
        for (const id of columnOrder["Accept"] ?? []) {
          decisions.push({ domainApplicationId: id, type: "Accepted" });
        }
        for (const [rank, id] of (columnOrder["Waitlist"] ?? []).entries()) {
          decisions.push({ domainApplicationId: id, type: "Waitlisted" });
        }
        for (const id of columnOrder["Reject"] ?? []) {
          decisions.push({ domainApplicationId: id, type: "Rejected" });
        }
      }

      // Create Final decisions and close session in a transaction.
      // Decisions go straight to Final so the hiring lead can release them.
      await prisma.$transaction(async (tx) => {
        for (const [index, d] of decisions.entries()) {
          await tx.decision.create({
            data: {
              domainApplicationId: d.domainApplicationId,
              type: d.type as any,
              stage: "Final",
              madeById: member.id,
              waitlistRank: d.type === "Waitlisted" ? index + 1 : null,
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
