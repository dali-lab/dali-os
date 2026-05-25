import type { Route } from "./+types/api.cycles.$cycleId.interviews";
import { prisma } from "~/lib/db";
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

  const [interviews, pendingCandidates] = await Promise.all([
    prisma.interview.findMany({
      where: { applicationCycleId: params.cycleId },
      include: {
        domainApplication: {
          include: {
            application: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true } },
              },
            },
            challengeVersion: { include: { domain: true } },
          },
        },
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
    // Pre-filter: DAs in this cycle with at least one Released
    // InvitedToInterview decision and no Scheduled or Completed interview. We
    // confirm the *latest* Released decision is InvitedToInterview in JS — a
    // follow-up Rejected/Waitlisted would override and the candidate is no
    // longer awaiting scheduling. Cancelled interviews stay pending so they
    // can be rescheduled.
    prisma.domainApplication.findMany({
      where: {
        selected: true,
        application: { applicationCycleId: params.cycleId },
        decisions: {
          some: { type: "InvitedToInterview", stage: "Released" },
        },
        interviews: { none: { status: { in: ["Scheduled", "Completed"] } } },
      },
      include: {
        application: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        domain: true,
        challengeVersion: { include: { domain: true } },
        decisions: {
          where: { stage: "Released" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, type: true, createdAt: true },
        },
      },
    }),
  ]);

  const pending = pendingCandidates
    .filter((da) => da.decisions[0]?.type === "InvitedToInterview")
    .map((da) => ({
      id: da.id,
      invitedAt: da.decisions[0]!.createdAt,
      domainApplication: {
        id: da.id,
        domain: { name: da.domain.name },
        challengeVersion: da.challengeVersion?.domain
          ? { domain: { name: da.challengeVersion.domain.name } }
          : null,
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
