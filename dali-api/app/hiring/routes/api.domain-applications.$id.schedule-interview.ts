import type { Route } from "./+types/api.domain-applications.$id.schedule-interview";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { assignInterviewers } from "~/hiring/lib/scheduling";
// import { provisionZoomMeeting } from "~/lib/zoom"; // S2S Zoom not configured yet
import { parseJson } from "~/lib/validate";
import { sendInterviewInviteEmails } from "~/hiring/lib/interview-emails";

const ScheduleInterviewSchema = z.object({
  startTime: z.string().datetime({ offset: true }),
  mode: z.enum(["in-person", "online"]).optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return withAuth(auth, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, ScheduleInterviewSchema);
  if (body instanceof Response) return withAuth(auth, body);
  const { startTime, mode } = body;
  const interviewMode = mode === "in-person" ? "in-person" as const : "online" as const;

  const da = await prisma.domainApplication.findUnique({
    where: { id: params.id },
    include: {
      application: true,
      challengeVersion: { select: { domainId: true } },
      // Only the active row (if any) — historical Cancelled/Completed rows
      // don't block a fresh booking.
      interviews: { where: { status: "Scheduled" } },
    },
  });

  if (!da || !da.selected) {
    return withAuth(auth, Response.json({ error: "Domain application not found" }, { status: 404 }));
  }

  if (da.application.userId !== auth.user.sub) {
    return withAuth(auth, Response.json({ error: "Not your application" }, { status: 403 }));
  }

  const latestDecision = await prisma.decision.findFirst({
    where: { domainApplicationId: da.id, stage: "Released" },
    orderBy: { createdAt: "desc" },
  });
  if (!latestDecision || latestDecision.type !== "InvitedToInterview") {
    return withAuth(auth, Response.json({ error: "Not invited to interview" }, { status: 403 }));
  }

  if (da.interviews.length > 0) {
    return withAuth(auth, Response.json({ error: "Interview already scheduled" }, { status: 409 }));
  }

  // DomainApplications always attach to a domain-scoped challenge version.
  // The general application form has `domainId = null`, but DomainApplication
  // rows are never created for general forms — defensive guard in case that
  // invariant ever breaks.
  if (!da.challengeVersion.domainId) {
    return withAuth(auth, Response.json({ error: "Domain application is not attached to a domain" }, { status: 400 }));
  }

  const config = await prisma.interviewConfig.findUnique({
    where: { applicationCycleId: da.application.applicationCycleId },
  });
  if (!config) {
    return withAuth(auth, Response.json({ error: "No interview config for this cycle" }, { status: 400 }));
  }

  const slotStart = new Date(startTime);
  const slotEnd = new Date(slotStart.getTime() + config.slotDurationMinutes * 60_000);

  try {
    const interview = await assignInterviewers(
      da.application.applicationCycleId,
      da.id,
      [da.challengeVersion.domainId],
      slotStart,
      slotEnd,
      undefined,
      interviewMode,
    );

    // S2S Zoom not configured yet — meeting links are set manually by admins
    // if (interview.location === "Online") {
    //   try {
    //     await provisionZoomMeeting(interview.id, "DALI Lab Interview", slotStart, config.slotDurationMinutes);
    //   } catch (err) {
    //     console.error("Failed to provision Zoom meeting:", err);
    //   }
    // }

    // Best-effort: send calendar invites to applicant + interviewers
    sendInterviewInviteEmails(interview.id, da.id).catch(() => {});

    return withAuth(auth, Response.json(interview, { status: 201 }));
  } catch (err: any) {
    return withAuth(auth, Response.json({ error: err.message }, { status: 409 }));
  }
}
