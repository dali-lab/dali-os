import type { Route } from "./+types/api.interview-assignments.$id.notes";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";

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
        include: { daliMember: true },
      },
    },
  });

  if (!assignment) {
    return Response.json({ error: "Assignment not found" }, { status: 404 });
  }

  if (assignment.cycleInterviewer.daliMember.userId !== auth.user.sub) {
    return Response.json({ error: "Not your assignment" }, { status: 403 });
  }

  const body = await request.json();
  const { content } = body;

  if (content === undefined) {
    return Response.json({ error: "content is required" }, { status: 400 });
  }

  const version = await prisma.interviewNoteVersion.create({
    data: {
      interviewAssignmentId: params.id,
      content,
    },
  });

  return Response.json(version, { status: 201 });
}
