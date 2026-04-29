import type { Route } from "./+types/api.members.$memberId.roles";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { safeJson } from "~/lib/safe-json";
import { logAuditEvent } from "~/lib/audit";
import type { MemberRole } from "~/generated/prisma/enums";

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub))) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  if (request.method !== "PATCH") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await safeJson<Record<string, unknown>>(request);
  if (body instanceof Response) return withCors(request, body);
  const roles: MemberRole[] = body.roles as MemberRole[];

  if (!Array.isArray(roles)) {
    return withCors(request, Response.json({ error: "roles must be an array" }, { status: 400 }));
  }

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
