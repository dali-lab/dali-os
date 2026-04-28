import type { Route } from "./+types/api.cycles.$cycleId.my-availability";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { safeJson } from "~/lib/safe-json";

// Return every CycleInterviewer row the authenticated member has in this
// cycle. A member who serves multiple domains has multiple rows; availability
// is a per-human concept, so writes fan out across every row.
async function findCycleInterviewers(userId: string, cycleId: string) {
  const member = await prisma.dALIMember.findFirst({ where: { userId } });
  if (!member) return [];
  return prisma.cycleInterviewer.findMany({
    where: { daliMemberId: member.id, applicationCycleId: cycleId },
    select: { id: true },
  });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const interviewers = await findCycleInterviewers(auth.user.sub, params.cycleId!);
  if (interviewers.length === 0) {
    return withCors(request, Response.json([]));
  }

  // All of the member's rows should hold the same availability set after a
  // PUT, so reading from any of them gives the canonical view. Read from
  // the first row for simplicity.
  const blocks = await prisma.interviewerAvailability.findMany({
    where: { cycleInterviewerId: interviewers[0].id },
    orderBy: { startTime: "asc" },
  });

  return withCors(request, Response.json(blocks));
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "PUT") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const interviewers = await findCycleInterviewers(auth.user.sub, params.cycleId!);
  if (interviewers.length === 0) {
    return withCors(request, Response.json({ error: "Not an interviewer for this cycle" }, { status: 404 }));
  }

  const body = await safeJson<{ blocks?: { startTime: string; endTime: string }[] }>(request);
  if (body instanceof Response) return withCors(request, body);
  const blocks: { startTime: string; endTime: string }[] = body.blocks ?? [];
  const parsedBlocks = blocks.map((b) => ({
    startTime: new Date(b.startTime),
    endTime: new Date(b.endTime),
  }));

  // Full replacement applied across EVERY row the member has in this cycle.
  // Fans the same availability set out to each CycleInterviewer so reads
  // from the scheduler and from the "Interviewers for this Domain" panel
  // agree, regardless of which row Prisma returns first.
  await prisma.$transaction(async (tx) => {
    for (const interviewer of interviewers) {
      await tx.interviewerAvailability.deleteMany({
        where: { cycleInterviewerId: interviewer.id },
      });
      if (parsedBlocks.length > 0) {
        await tx.interviewerAvailability.createMany({
          data: parsedBlocks.map((b) => ({
            cycleInterviewerId: interviewer.id,
            startTime: b.startTime,
            endTime: b.endTime,
          })),
        });
      }
    }
  });

  const updated = await prisma.interviewerAvailability.findMany({
    where: { cycleInterviewerId: interviewers[0].id },
    orderBy: { startTime: "asc" },
  });

  return withCors(request, Response.json(updated));
}
