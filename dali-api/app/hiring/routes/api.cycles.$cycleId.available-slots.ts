import type { Route } from "./+types/api.cycles.$cycleId.available-slots";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { hasCycleAccess } from "~/lib/roles";
import { computeAvailableSlots } from "~/hiring/lib/scheduling";

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  // Allow cycle members (leads, reviewers, interviewers) OR applicants
  // who have been invited to interview for this cycle
  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!))) {
    const invited = await prisma.domainApplication.findFirst({
      where: {
        selected: true,
        application: { userId: auth.user.sub, applicationCycleId: params.cycleId },
        decisions: { some: { type: "InvitedToInterview", supersededAt: null } },
      },
      select: { id: true },
    });
    if (!invited)
      return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const url = new URL(request.url);
  const domainIds = url.searchParams.getAll("domainId");

  if (domainIds.length === 0) {
    return withCors(request, Response.json({ error: "At least one domainId query param required" }, { status: 400 }));
  }

  const mode = url.searchParams.get("mode") === "in-person" ? "in-person" as const : "online" as const;
  const slots = await computeAvailableSlots(params.cycleId, domainIds, mode);

  return withCors(request, Response.json(slots));
}
