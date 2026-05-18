import type { Route } from "./+types/api.offerings.$id.publish";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const id = params.id!;
  const gate = await requireEducationManager(request, id);
  if (!gate.ok) return gate.response;

  const body = (await request.json()) as { status: "Draft" | "Published" | "Archived" };
  if (!["Draft", "Published", "Archived"].includes(body.status)) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }
  const offering = await prisma.educationOffering.update({
    where: { id },
    data: { status: body.status },
  });
  return Response.json({ offering });
}
