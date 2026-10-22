import type { Route } from "./+types/api.cycles.$cycleId.interviews";
import { prisma } from "~/lib/db";
import { FIRST_INTERVIEW_ROUND_ID } from "~/hiring/lib/cycle-timeline";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { hasCycleAccess } from "~/lib/roles";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!)))
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  const gate = await requireApiSignedOrForbidden(auth.user.sub, params.cycleId!);
  if (gate) return withCors(request, gate);

  // One Interviews round at a time: its interviews, and who it invited.
  const roundId = new URL(request.url).searchParams.get("round") ?? FIRST_INTERVIEW_ROUND_ID;
  const [interviews, pendingCandidates] = await Promise.all([
    prisma.interview.findMany({
      where: { applicationCycleId: params.cycleId, interviewRoundId: roundId },
      include: {
        domainApplication: {
          include: {
            application: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true } },
              },
            },
            domain: true,
            challengeFormVersion: { select: { questions: true, intro: true } },
          },
        },
        room: { select: { id: true, name: true } },
        assignments: {
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
      orderBy: { startTime: "asc" },
    }),
    // Pre-filter: DAs in this cycle with a Released invite to this round and
    // no Scheduled interview. We confirm in JS that the *latest* Released
    // decision is that invite (a follow-up Rejected/Waitlisted, or an invite
    // to a later round, overrides it) and that they haven't already
    // interviewed in this round. Cancelled interviews stay pending so they
    // can be rescheduled.
    prisma.domainApplication.findMany({
      where: {
        selected: true,
        application: { applicationCycleId: params.cycleId },
        decisions: {
          some: { type: "InvitedToInterview", stage: "Released", interviewRoundId: roundId },
        },
        interviews: { none: { status: "Scheduled" } },
      },
      include: {
        application: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        domain: true,
        decisions: {
          where: { stage: "Released" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, type: true, interviewRoundId: true, createdAt: true },
        },
        interviews: { where: { status: "Completed", interviewRoundId: roundId }, select: { id: true } },
      },
    }),
  ]);

  const pending = pendingCandidates
    .filter(
      (da) =>
        da.decisions[0]?.type === "InvitedToInterview" &&
        da.decisions[0].interviewRoundId === roundId &&
        da.interviews.length === 0,
    )
    .map((da) => ({
      id: da.id,
      invitedAt: da.decisions[0]!.createdAt,
      domainApplication: {
        id: da.id,
        domain: { name: da.domain.name },
        application: {
          user: {
            id: da.application.user.id,
            firstName: da.application.user.firstName,
            lastName: da.application.user.lastName,
          },
        },
      },
    }));

  return withCors(request, Response.json({ interviews, pending }));
}
