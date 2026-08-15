import type { Route } from "./+types/api.cycles.$cycleId.my-interviews";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const member = await prisma.dALIMember.findUnique({ where: { userId: auth.user.sub } });
  if (!member) return withCors(request, Response.json([]));

  // A member can have multiple CycleInterviewer rows in the same cycle (one
  // per domain), and a manual reassignment can write an assignment under any
  // of them — so fetch assignments across ALL of the member's rows.
  const interviewerRows = await prisma.cycleInterviewer.findMany({
    where: { userId: auth.user.sub, applicationCycleId: params.cycleId },
    select: { id: true },
  });
  if (interviewerRows.length === 0) return withCors(request, Response.json([]));

  const gate = await requireApiSignedOrForbidden(auth.user.sub, params.cycleId!);
  if (gate) return withCors(request, gate);

  const assignments = await prisma.interviewAssignment.findMany({
    where: {
      cycleInterviewerId: { in: interviewerRows.map((r) => r.id) },
      status: "Active",
      // An Active assignment can still hang off a cancelled interview when a
      // cancel path forgot to decline its assignments (the reschedule path
      // historically did). Gate on the interview itself so the dashboard
      // never surfaces a cancelled slot regardless of assignment bookkeeping.
      interview: { status: "Scheduled" },
    },
    include: {
      interview: {
        include: {
          domainApplication: {
            include: {
              application: {
                include: {
                  user: { select: { firstName: true, lastName: true } },
                },
              },
              domain: true,
            },
          },
          assignments: {
            where: { status: "Active" },
            include: {
              cycleInterviewer: {
                include: {
                  user: true,
                  domain: true,
                },
              },
            },
          },
        },
      },
      noteVersions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { interview: { startTime: "asc" } },
  });

  return withCors(request, Response.json(assignments));
}
