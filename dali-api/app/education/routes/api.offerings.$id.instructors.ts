import type { Route } from "./+types/api.offerings.$id.instructors";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";
import { currentTerm } from "~/lib/roles";

// POST { userId }  → add instructor
// DELETE { userId } → remove instructor

export async function action({ request, params }: Route.ActionArgs) {
  const offeringId = params.id!;
  const gate = await requireEducationManager(request, offeringId);
  if (!gate.ok) return gate.response;

  const body = (await request.json()) as { userId: string };
  if (!body.userId) {
    return Response.json({ error: "userId required" }, { status: 400 });
  }
  const term = await currentTerm();
  if (!term) {
    return Response.json({ error: "No current term" }, { status: 500 });
  }

  if (request.method === "POST") {
    try {
      const assignment = await prisma.instructorAssignment.create({
        data: { userId: body.userId, offeringId, termId: term.id },
      });
      return Response.json({ assignment }, { status: 201 });
    } catch {
      return Response.json({ error: "Already assigned" }, { status: 409 });
    }
  }

  if (request.method === "DELETE") {
    await prisma.instructorAssignment.deleteMany({
      where: { userId: body.userId, offeringId, termId: term.id },
    });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
