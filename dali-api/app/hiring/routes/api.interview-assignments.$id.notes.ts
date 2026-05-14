import type { Route } from "./+types/api.interview-assignments.$id.notes";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

const NoteVersionSchema = z.object({
  content: z.string().max(100_000),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const assignment = await prisma.interviewAssignment.findUnique({
    where: { id: params.id },
    select: { interview: { select: { applicationCycleId: true } } },
  });
  if (!assignment) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await hasCycleAccess(auth.user.sub, assignment.interview.applicationCycleId)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    assignment.interview.applicationCycleId,
  );
  if (gate) return gate;

  const versions = await prisma.interviewNoteVersion.findMany({
    where: { interviewAssignmentId: params.id },
    orderBy: { createdAt: "desc" },
  });

  return Response.json(versions);
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Verify the assignment belongs to the current user's CycleInterviewer
  const assignment = await prisma.interviewAssignment.findUnique({
    where: { id: params.id },
    include: {
      cycleInterviewer: {
        include: { user: true },
      },
      interview: { select: { applicationCycleId: true } },
    },
  });

  if (!assignment) {
    return Response.json({ error: "Assignment not found" }, { status: 404 });
  }

  if (assignment.cycleInterviewer.userId !== auth.user.sub) {
    return Response.json({ error: "Not your assignment" }, { status: 403 });
  }

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    assignment.interview.applicationCycleId,
  );
  if (gate) return gate;

  const body = await parseJson(request, NoteVersionSchema);
  if (body instanceof Response) return body;
  const { content } = body;

  const version = await prisma.interviewNoteVersion.create({
    data: {
      interviewAssignmentId: params.id,
      content,
    },
  });

  return Response.json(version, { status: 201 });
}
