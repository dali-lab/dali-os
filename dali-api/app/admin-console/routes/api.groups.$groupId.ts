import type { Route } from "./+types/api.groups.$groupId";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";

const UpdateGroupSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  staticMemberIds: z.array(z.string().min(1)).min(1).optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub)))
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  const groupId = params.groupId!;

  if (request.method === "DELETE") {
    const existing = await prisma.groupDefinition.findUnique({ where: { id: groupId } });
    if (!existing)
      return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
    await prisma.groupDefinition.delete({ where: { id: groupId } });
    return withCors(request, new Response(null, { status: 204 }));
  }

  if (request.method === "PUT" || request.method === "PATCH") {
    const body = await parseJson(request, UpdateGroupSchema);
    if (body instanceof Response) return withCors(request, body);

    const updated = await prisma.groupDefinition.update({
      where: { id: groupId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.staticMemberIds !== undefined ? { staticMemberIds: body.staticMemberIds } : {}),
      },
    });
    return withCors(request, Response.json(updated));
  }

  return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
}
