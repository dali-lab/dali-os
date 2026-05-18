import type { Route } from "./+types/api.questions.$id";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";

export async function action({ request, params }: Route.ActionArgs) {
  const id = params.id!;
  const existing = await prisma.educationApplicationQuestion.findUnique({
    where: { id },
    select: { offeringId: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  const gate = await requireEducationManager(request, existing.offeringId);
  if (!gate.ok) return gate.response;

  if (request.method === "PUT" || request.method === "PATCH") {
    const body = (await request.json()) as Partial<{
      prompt: string;
      position: number;
      required: boolean;
    }>;
    const question = await prisma.educationApplicationQuestion.update({
      where: { id },
      data: {
        ...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        ...(body.required !== undefined ? { required: body.required } : {}),
      },
    });
    return Response.json({ question });
  }
  if (request.method === "DELETE") {
    await prisma.educationApplicationQuestion.delete({ where: { id } });
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
