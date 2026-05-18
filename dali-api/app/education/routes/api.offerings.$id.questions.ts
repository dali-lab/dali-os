import type { Route } from "./+types/api.offerings.$id.questions";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const offeringId = params.id!;
  const gate = await requireEducationManager(request, offeringId);
  if (!gate.ok) return gate.response;

  const body = (await request.json()) as {
    prompt: string;
    position?: number;
    required?: boolean;
  };
  if (!body.prompt?.trim()) {
    return Response.json({ error: "prompt required" }, { status: 400 });
  }
  const max = await prisma.educationApplicationQuestion.aggregate({
    where: { offeringId },
    _max: { position: true },
  });
  const question = await prisma.educationApplicationQuestion.create({
    data: {
      offeringId,
      prompt: body.prompt.trim(),
      position: body.position ?? (max._max.position ?? -1) + 1,
      required: body.required ?? true,
    },
  });
  return Response.json({ question }, { status: 201 });
}
