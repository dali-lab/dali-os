import type { Route } from "./+types/api.submissions.$id.grade";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";

async function offeringIdForSubmission(id: string): Promise<string | null> {
  const s = await prisma.educationSubmission.findUnique({
    where: { id },
    select: {
      assignment: {
        select: {
          offeringId: true,
          session: { select: { offeringId: true } },
        },
      },
    },
  });
  if (!s) return null;
  return s.assignment.offeringId ?? s.assignment.session?.offeringId ?? null;
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const id = params.id!;
  const offeringId = await offeringIdForSubmission(id);
  if (!offeringId) return Response.json({ error: "Not found" }, { status: 404 });
  const gate = await requireEducationManager(request, offeringId);
  if (!gate.ok) return gate.response;

  const submission = await prisma.educationSubmission.update({
    where: { id },
    data: { gradedAt: new Date() },
  });
  return Response.json({ submission });
}
