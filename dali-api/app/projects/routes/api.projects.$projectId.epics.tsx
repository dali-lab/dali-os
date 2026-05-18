import { z } from "zod";
import type { Route } from "./+types/api.projects.$projectId.epics";
import { requireAuth } from "~/lib/auth";
import { requireProjectEditor } from "~/lib/projectAuth";
import { prisma } from "~/lib/db";
import { parseJson } from "~/lib/validate";

const EpicStatusEnum = z.enum(["Open", "InProgress", "Done", "Cancelled"]);

const CreateEpicSchema = z.object({
  title: z.string().trim().min(1).max(200),
  status: EpicStatusEnum.default("Open"),
  targetTermId: z.string().nullable().optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectEditor(auth.user.sub, params.projectId!);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await parseJson(request, CreateEpicSchema);
  if (body instanceof Response) return body;

  const max = await prisma.epic.findFirst({
    where: { projectId: params.projectId! },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const epic = await prisma.epic.create({
    data: {
      projectId: params.projectId!,
      title: body.title,
      status: body.status,
      targetTermId: body.targetTermId ?? null,
      position: (max?.position ?? -1) + 1,
      descriptionDocId: undefined,
    },
  });
  await prisma.epic.update({
    where: { id: epic.id },
    data: { descriptionDocId: `epic:${epic.id}:description` },
  });

  return Response.json(epic, { status: 201 });
}
