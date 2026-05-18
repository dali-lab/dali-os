import { z } from "zod";
import type { Route } from "./+types/api.projects.$projectId.sprints.$sprintId";
import { requireAuth } from "~/lib/auth";
import { requireProjectEditor } from "~/lib/projectAuth";
import { prisma } from "~/lib/db";
import { parseJson } from "~/lib/validate";

const SprintStatusEnum = z.enum(["Planned", "Active", "Closed"]);

const UpdateSprintSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  startsAt: z.string().min(8).optional(),
  endsAt: z.string().min(8).optional(),
  status: SprintStatusEnum.optional(),
});

function dateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectEditor(auth.user.sub, params.projectId!);

  const sprintId = params.sprintId!;
  const existing = await prisma.sprint.findUnique({ where: { id: sprintId } });
  if (!existing || existing.projectId !== params.projectId) {
    return Response.json({ error: "Sprint not found" }, { status: 404 });
  }

  if (request.method === "DELETE") {
    await prisma.task.updateMany({
      where: { sprintId },
      data: { sprintId: null },
    });
    await prisma.sprint.delete({ where: { id: sprintId } });
    return Response.json({ ok: true });
  }

  if (request.method !== "PATCH" && request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await parseJson(request, UpdateSprintSchema);
  if (body instanceof Response) return body;

  type SprintStatus = z.infer<typeof SprintStatusEnum>;
  const data: {
    name?: string;
    startsAt?: Date;
    endsAt?: Date;
    status?: SprintStatus;
  } = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.startsAt !== undefined) data.startsAt = dateOnly(body.startsAt);
  if (body.endsAt !== undefined) data.endsAt = dateOnly(body.endsAt);
  if (body.status !== undefined) data.status = body.status;

  const updated = await prisma.sprint.update({
    where: { id: sprintId },
    data,
  });
  return Response.json(updated);
}
