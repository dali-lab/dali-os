import type { Route } from "./+types/api.members.$memberId.roles";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";

const MEMBER_ROLES = ["Admin", "HiringLead"] as const;

const RolesPatchSchema = z.object({
  roles: z.array(z.enum(MEMBER_ROLES)).max(MEMBER_ROLES.length),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub))) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  if (request.method !== "PATCH") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, RolesPatchSchema);
  if (body instanceof Response) return withCors(request, body);
  const { roles } = body;

  const before = await prisma.dALIMember.findUnique({
    where: { id: params.memberId },
    select: { roles: true },
  });

  const member = await prisma.dALIMember.update({
    where: { id: params.memberId },
    data: { roles },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });

  await logAuditEvent({
    action: "role.change",
    userId: auth.user.sub,
    targetId: params.memberId,
    metadata: {
      before: before?.roles ?? [],
      after: roles,
      targetMemberId: params.memberId,
    },
    request,
  });

  return withCors(request, Response.json(member));
}
