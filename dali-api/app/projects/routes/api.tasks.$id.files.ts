import type { Route } from "./+types/api.tasks.$id.files";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";

// POST   /api/tasks/:id/files { fileId } — link a project file (work artifact)
//        to the task. Idempotent: re-linking an already-linked file is a no-op.
// DELETE /api/tasks/:id/files { fileId } — unlink. The file itself stays.
//
// The file must belong to the task's project and be live (not archived).
// Permission mirrors task edit (isCore === Admin || Core, or a project member).

const BodySchema = z.object({ fileId: z.string().min(1) });

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST" && request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    select: { id: true, projectId: true },
  });
  if (!task) {
    return withCors(request, Response.json({ error: "Task not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, task.projectId);
  if (!gate.ok) return gate.response;

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  if (request.method === "DELETE") {
    await prisma.taskFileLink.deleteMany({
      where: { taskId: task.id, fileId: body.fileId },
    });
    return withCors(request, Response.json({ ok: true }));
  }

  const file = await prisma.projectFile.findUnique({
    where: { id: body.fileId },
    select: {
      id: true,
      title: true,
      projectId: true,
      archivedAt: true,
      _count: { select: { versions: true } },
    },
  });
  if (!file || file.archivedAt !== null || file.projectId !== task.projectId) {
    return withCors(request, Response.json({ error: "File not found" }, { status: 404 }));
  }

  await prisma.taskFileLink.createMany({
    data: [{ taskId: task.id, fileId: file.id }],
    skipDuplicates: true,
  });

  // The linked-artifact shape TaskCardModel carries, so the modal can update
  // its local list without a refetch.
  return withCors(
    request,
    Response.json(
      { id: file.id, title: file.title, versionCount: file._count.versions },
      { status: 201 },
    ),
  );
}
