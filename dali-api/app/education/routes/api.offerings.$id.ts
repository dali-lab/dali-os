import type { Route } from "./+types/api.offerings.$id";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";

// PUT updates metadata; DELETE archives (we keep history for analytics).

export async function action({ request, params }: Route.ActionArgs) {
  const id = params.id!;
  const gate = await requireEducationManager(request, id);
  if (!gate.ok) return gate.response;

  if (request.method === "PUT" || request.method === "PATCH") {
    const body = (await request.json()) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const k of [
      "title",
      "capacity",
      "registrationOpensAt",
      "registrationClosesAt",
      "startsAt",
      "endsAt",
      "requiresReview",
      "calendarEmail",
      "descriptionDocId",
    ] as const) {
      if (!(k in body)) continue;
      const v = body[k];
      if (k.endsWith("At")) data[k] = v ? new Date(v as string) : null;
      else if (k === "capacity") data[k] = Math.floor(Number(v));
      else data[k] = v;
    }
    const offering = await prisma.educationOffering.update({
      where: { id },
      data,
    });
    return Response.json({ offering });
  }

  if (request.method === "DELETE") {
    const offering = await prisma.educationOffering.update({
      where: { id },
      data: { status: "Archived" },
    });
    return Response.json({ offering });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
