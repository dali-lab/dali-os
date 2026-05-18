import { z } from "zod";
import type { Route } from "./+types/api.projects.$projectId";
import { requireAuth } from "~/lib/auth";
import { requireProjectSettingsEditor } from "~/lib/projectAuth";
import { prisma } from "~/lib/db";
import { parseJson } from "~/lib/validate";

const UpdateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  calendarEmail: z.string().email().nullable().optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectSettingsEditor(auth.user.sub, params.projectId!);

  if (request.method !== "PATCH" && request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await parseJson(request, UpdateProjectSchema);
  if (body instanceof Response) return body;

  const project = await prisma.project.update({
    where: { id: params.projectId! },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.calendarEmail !== undefined ? { calendarEmail: body.calendarEmail } : {}),
    },
  });
  return Response.json(project);
}
