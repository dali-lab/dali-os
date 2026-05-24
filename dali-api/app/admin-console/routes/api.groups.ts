import type { Route } from "./+types/api.groups";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { listVisibleGroupsForUser } from "~/lib/groups";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";

const CreateGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  staticMemberIds: z.array(z.string().min(1)).min(1),
});

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub)))
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  // Per-viewer visibility: a group surfaces only when the caller is a member.
  const groups = await listVisibleGroupsForUser(auth.user.sub);
  return withCors(request, Response.json(groups));
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub)))
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, CreateGroupSchema);
  if (body instanceof Response) return withCors(request, body);

  const group = await prisma.groupDefinition.create({
    data: { name: body.name, type: "Static", staticMemberIds: body.staticMemberIds },
  });
  await logAuditEvent({
    action: "group.create",
    userId: auth.user.sub,
    targetId: group.id,
    metadata: { name: group.name, memberCount: body.staticMemberIds.length },
    request,
  });
  return withCors(request, Response.json(group, { status: 201 }));
}
