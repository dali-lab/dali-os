import type { Route } from "./+types/api.domains.$domainId.leads";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, currentTerm } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";

// Phase 2: domain-lead body uses `userId` (not `memberId`). The User must
// exist and (per the admin UI convention) be a lab member, though we only
// enforce the FK at the DB layer.

const AddLeadSchema = z.object({
  userId: z.string().min(1).max(100),
});

const RemoveLeadSchema = z.object({
  assignmentId: z.string().min(1).max(100),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub))) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  const leads = await prisma.domainLeadAssignment.findMany({
    where: { domainId: params.domainId },
    include: { user: true, domain: true, term: true },
  });

  return withCors(request, Response.json(leads));
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub))) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  if (request.method === "POST") {
    const postBody = await parseJson(request, AddLeadSchema);
    if (postBody instanceof Response) return withCors(request, postBody);
    const { userId } = postBody;

    const term = await currentTerm();
    if (!term) {
      return withCors(
        request,
        Response.json(
          { error: "No current Term — run npm run db:seed:v0-reference" },
          { status: 500 },
        ),
      );
    }

    const assignment = await prisma.domainLeadAssignment.create({
      data: { userId, domainId: params.domainId!, termId: term.id },
      include: { user: true, domain: true, term: true },
    });
    await logAuditEvent({
      action: "domain.lead.add",
      userId: auth.user.sub,
      targetId: userId,
      metadata: {
        domainId: params.domainId,
        assignmentId: assignment.id,
        termId: term.id,
      },
      request,
    });
    return withCors(request, Response.json(assignment, { status: 201 }));
  }

  if (request.method === "DELETE") {
    const delBody = await parseJson(request, RemoveLeadSchema);
    if (delBody instanceof Response) return withCors(request, delBody);
    const { assignmentId } = delBody;
    const removed = await prisma.domainLeadAssignment.delete({
      where: { id: assignmentId },
    });
    await logAuditEvent({
      action: "domain.lead.remove",
      userId: auth.user.sub,
      targetId: removed.userId,
      metadata: {
        domainId: params.domainId,
        assignmentId,
        termId: removed.termId,
      },
      request,
    });
    return withCors(request, Response.json({ ok: true }));
  }

  return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
}
