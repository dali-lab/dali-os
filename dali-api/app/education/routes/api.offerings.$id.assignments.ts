import type { Route } from "./+types/api.offerings.$id.assignments";
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
    title: string;
    sessionId?: string | null;
    submissionType: "Text" | "File" | "Mixed";
    dueAt?: string | null;
  };
  if (!body.title?.trim()) {
    return Response.json({ error: "title required" }, { status: 400 });
  }
  const assignment = await prisma.educationAssignment.create({
    data: {
      title: body.title.trim(),
      submissionType: body.submissionType,
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
      // Per schema rule: exactly one of offeringId / sessionId is set.
      offeringId: body.sessionId ? null : offeringId,
      sessionId: body.sessionId ?? null,
    },
  });
  return Response.json({ assignment }, { status: 201 });
}
