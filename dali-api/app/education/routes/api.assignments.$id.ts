import type { Route } from "./+types/api.assignments.$id";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";

async function offeringIdForAssignment(id: string): Promise<string | null> {
  const a = await prisma.educationAssignment.findUnique({
    where: { id },
    select: {
      offeringId: true,
      session: { select: { offeringId: true } },
    },
  });
  if (!a) return null;
  return a.offeringId ?? a.session?.offeringId ?? null;
}

export async function action({ request, params }: Route.ActionArgs) {
  const id = params.id!;
  const offeringId = await offeringIdForAssignment(id);
  if (!offeringId) return Response.json({ error: "Not found" }, { status: 404 });
  const gate = await requireEducationManager(request, offeringId);
  if (!gate.ok) return gate.response;

  if (request.method === "PUT" || request.method === "PATCH") {
    const body = (await request.json()) as Partial<{
      title: string;
      dueAt: string | null;
      submissionType: "Text" | "File" | "Mixed";
    }>;
    const assignment = await prisma.educationAssignment.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(body.dueAt) : null } : {}),
        ...(body.submissionType !== undefined ? { submissionType: body.submissionType } : {}),
      },
    });
    return Response.json({ assignment });
  }
  if (request.method === "DELETE") {
    await prisma.educationAssignment.delete({ where: { id } });
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
