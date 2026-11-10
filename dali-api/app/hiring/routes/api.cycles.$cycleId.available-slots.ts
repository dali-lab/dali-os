import type { Route } from "./+types/api.cycles.$cycleId.available-slots";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { hasCycleAccess } from "~/lib/roles";
import { computeAvailableSlots } from "~/hiring/lib/scheduling";
import { invitedRoundId } from "~/hiring/lib/interview-rounds.server";
import { FIRST_INTERVIEW_ROUND_ID } from "~/hiring/lib/cycle-timeline";

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const url = new URL(request.url);
  // Cycle members (leads, reviewers, interviewers) name the round; applicants
  // invited to interview see the round they're invited to.
  let roundId = url.searchParams.get("round") ?? FIRST_INTERVIEW_ROUND_ID;
  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!))) {
    const invited = await prisma.domainApplication.findFirst({
      where: {
        selected: true,
        application: { userId: auth.user.sub, applicationCycleId: params.cycleId },
        decisions: { some: { type: "InvitedToInterview" } },
      },
      select: { id: true },
    });
    const round = invited && (await invitedRoundId(invited.id));
    if (!round)
      return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
    roundId = round;
  }

  const domainIds = url.searchParams.getAll("domainId");

  if (domainIds.length === 0) {
    return withCors(request, Response.json({ error: "At least one domainId query param required" }, { status: 400 }));
  }

  const mode = url.searchParams.get("mode") === "in-person" ? "in-person" as const : "online" as const;
  const slots = await computeAvailableSlots(params.cycleId, roundId, domainIds, mode);

  return withCors(request, Response.json(slots));
}
