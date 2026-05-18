import { z } from "zod";
import type { Route } from "./+types/api.projects.$projectId.epics.$epicId";
import { requireAuth } from "~/lib/auth";
import { requireProjectEditor } from "~/lib/projectAuth";
import { prisma } from "~/lib/db";
import { parseJson } from "~/lib/validate";

const UpdateEpicSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["Open", "InProgress", "Done", "Cancelled"]).optional(),
  targetTermId: z.string().nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectEditor(auth.user.sub, params.projectId!);

  const epicId = params.epicId!;
  const existing = await prisma.epic.findUnique({ where: { id: epicId } });
  if (!existing || existing.projectId !== params.projectId) {
    return Response.json({ error: "Epic not found" }, { status: 404 });
  }

  if (request.method === "DELETE") {
    await prisma.task.updateMany({
      where: { epicId },
      data: { epicId: null },
    });
    await prisma.epic.delete({ where: { id: epicId } });
    return Response.json({ ok: true });
  }

  if (request.method !== "PATCH" && request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await parseJson(request, UpdateEpicSchema);
  if (body instanceof Response) return body;

  const updated = await prisma.epic.update({
    where: { id: epicId },
    data: body,
  });
  return Response.json(updated);
}
