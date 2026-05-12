import type { Route } from "./+types/api.domains.$domainId.leads";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { getCurrentTermId } from "~/lib/terms";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";

const AddLeadSchema = z.object({
  memberId: z.string().min(1).max(100),
});

const RemoveLeadSchema = z.object({
  assignmentId: z.string().min(1).max(100),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub))) return withAuth(auth, withCors(request, Response.json({ error: "Forbidden" }, { status: 403 })));

  const leads = await prisma.domainLeadAssignment.findMany({
    where: { domainId: params.domainId },
    include: { member: { include: { user: true } }, domain: true },
  });

  return withAuth(auth, withCors(request, Response.json(leads)));
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub))) return withAuth(auth, withCors(request, Response.json({ error: "Forbidden" }, { status: 403 })));

  if (request.method === "POST") {
    const postBody = await parseJson(request, AddLeadSchema);
    if (postBody instanceof Response) return withAuth(auth, withCors(request, postBody));
    const { memberId } = postBody;
    const termId = await getCurrentTermId();

    const assignment = await prisma.domainLeadAssignment.create({
      data: { memberId, domainId: params.domainId!, termId },
      include: { member: { include: { user: true } }, domain: true },
    });
    return withAuth(auth, withCors(request, Response.json(assignment, { status: 201 })));
  }

  if (request.method === "DELETE") {
    const delBody = await parseJson(request, RemoveLeadSchema);
    if (delBody instanceof Response) return withAuth(auth, withCors(request, delBody));
    const { assignmentId } = delBody;
    await prisma.domainLeadAssignment.delete({ where: { id: assignmentId } });
    return withAuth(auth, withCors(request, Response.json({ ok: true })));
  }

  return withAuth(auth, withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 })));
}
