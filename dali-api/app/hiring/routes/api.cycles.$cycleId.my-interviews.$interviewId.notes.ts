import type { Route } from "./+types/api.cycles.$cycleId.my-interviews.$interviewId.notes";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

const NoteVersionSchema = z.object({
  content: z.string().max(100_000),
});

async function getAssignment(userId: string, cycleId: string, interviewId: string) {
  const member = await prisma.dALIMember.findFirst({ where: { userId } });
  if (!member) return null;

  const interviewer = await prisma.cycleInterviewer.findFirst({
    where: { daliMemberId: member.id, applicationCycleId: cycleId },
  });
  if (!interviewer) return null;

  return prisma.interviewAssignment.findFirst({
    where: { interviewId, cycleInterviewerId: interviewer.id, status: "Active" },
  });
}

// GET: return version history for this interviewer's assignment (desc)
export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const assignment = await getAssignment(auth.user.sub, params.cycleId!, params.interviewId!);
  if (!assignment) {
    return withCors(request, Response.json({ error: "Assignment not found" }, { status: 404 }));
  }

  const gate = await requireApiSignedOrForbidden(auth.user.sub, params.cycleId!);
  if (gate) return withCors(request, gate);

  const versions = await prisma.interviewNoteVersion.findMany({
    where: { interviewAssignmentId: assignment.id },
    orderBy: { createdAt: "desc" },
  });

  return withCors(request, Response.json(versions));
}

// POST: append a new note version (auto-save)
export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const assignment = await getAssignment(auth.user.sub, params.cycleId!, params.interviewId!);
  if (!assignment) {
    return withCors(request, Response.json({ error: "Assignment not found" }, { status: 404 }));
  }

  const gate = await requireApiSignedOrForbidden(auth.user.sub, params.cycleId!);
  if (gate) return withCors(request, gate);

  const body = await parseJson(request, NoteVersionSchema);
  if (body instanceof Response) return withCors(request, body);
  const { content } = body;

  const version = await prisma.interviewNoteVersion.create({
    data: { interviewAssignmentId: assignment.id, content },
  });

  return withCors(request, Response.json(version, { status: 201 }));
}
