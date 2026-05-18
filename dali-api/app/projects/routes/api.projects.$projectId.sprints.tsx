import { z } from "zod";
import type { Route } from "./+types/api.projects.$projectId.sprints";
import { requireAuth } from "~/lib/auth";
import { requireProjectEditor } from "~/lib/projectAuth";
import { prisma } from "~/lib/db";
import { parseJson } from "~/lib/validate";

const SprintStatusEnum = z.enum(["Planned", "Active", "Closed"]);

const CreateSprintSchema = z.object({
  name: z.string().trim().min(1).max(120),
  startsAt: z.string().min(8), // YYYY-MM-DD
  endsAt: z.string().min(8),
  status: SprintStatusEnum.default("Planned"),
});

/**
 * Convert a YYYY-MM-DD string to a Date at midnight UTC. Sprint dates are
 * date-only in the UI; we store them as UTC midnight so they're stable across
 * time zones.
 */
function dateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectEditor(auth.user.sub, params.projectId!);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await parseJson(request, CreateSprintSchema);
  if (body instanceof Response) return body;

  const sprint = await prisma.sprint.create({
    data: {
      projectId: params.projectId!,
      name: body.name,
      startsAt: dateOnly(body.startsAt),
      endsAt: dateOnly(body.endsAt),
      status: body.status,
      goalDocId: undefined,
    },
  });

  // Attach a goal collab doc name (lazy — first edit upserts the row).
  await prisma.sprint.update({
    where: { id: sprint.id },
    data: { goalDocId: `sprint:${sprint.id}:goal` },
  });

  return Response.json(sprint, { status: 201 });
}
