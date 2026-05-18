import { z } from "zod";
import type { Route } from "./+types/api.projects.$projectId.role-requests";
import { requireAuth } from "~/lib/auth";
import { requireProjectSettingsEditor } from "~/lib/projectAuth";
import { prisma } from "~/lib/db";
import { parseJson } from "~/lib/validate";

const LevelEnum = z.enum(["P1", "P2", "P3"]);

const CreateSchema = z.object({
  termId: z.string().min(1),
  domainId: z.string().min(1),
  level: LevelEnum,
  slots: z.number().int().min(1).max(20),
});

const UpdateSchema = z.object({
  id: z.string().min(1),
  level: LevelEnum.optional(),
  slots: z.number().int().min(1).max(20).optional(),
});

const DeleteSchema = z.object({ id: z.string().min(1) });

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectSettingsEditor(auth.user.sub, params.projectId!);

  if (request.method === "POST") {
    const body = await parseJson(request, CreateSchema);
    if (body instanceof Response) return body;
    const row = await prisma.projectRoleRequest.create({
      data: {
        projectId: params.projectId!,
        termId: body.termId,
        domainId: body.domainId,
        level: body.level,
        slots: body.slots,
      },
    });
    return Response.json(row, { status: 201 });
  }

  if (request.method === "PATCH" || request.method === "PUT") {
    const body = await parseJson(request, UpdateSchema);
    if (body instanceof Response) return body;
    const row = await prisma.projectRoleRequest.update({
      where: { id: body.id },
      data: {
        ...(body.level !== undefined ? { level: body.level } : {}),
        ...(body.slots !== undefined ? { slots: body.slots } : {}),
      },
    });
    return Response.json(row);
  }

  if (request.method === "DELETE") {
    const body = await parseJson(request, DeleteSchema);
    if (body instanceof Response) return body;
    await prisma.projectRoleRequest.delete({ where: { id: body.id } });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
