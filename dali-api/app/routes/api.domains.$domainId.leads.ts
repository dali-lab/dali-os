import type { Route } from "./+types/api.domains.$domainId.leads";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { safeJson } from "~/lib/safe-json";

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub))) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  const leads = await prisma.domainLeadAssignment.findMany({
    where: { domainId: params.domainId },
    include: { member: { include: { user: true } }, domain: true },
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
    const postBody = await safeJson<{ memberId?: string }>(request);
    if (postBody instanceof Response) return withCors(request, postBody);
    const { memberId } = postBody;
    if (!memberId) {
      return withCors(request, Response.json({ error: "memberId is required" }, { status: 400 }));
    }

    const assignment = await prisma.domainLeadAssignment.create({
      data: { memberId, domainId: params.domainId! },
      include: { member: { include: { user: true } }, domain: true },
    });
    return withCors(request, Response.json(assignment, { status: 201 }));
  }

  if (request.method === "DELETE") {
    const delBody = await safeJson<{ assignmentId?: string }>(request);
    if (delBody instanceof Response) return withCors(request, delBody);
    const { assignmentId } = delBody;
    if (!assignmentId) {
      return withCors(request, Response.json({ error: "assignmentId is required" }, { status: 400 }));
    }
    await prisma.domainLeadAssignment.delete({ where: { id: assignmentId } });
    return withCors(request, Response.json({ ok: true }));
  }

  return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
}
