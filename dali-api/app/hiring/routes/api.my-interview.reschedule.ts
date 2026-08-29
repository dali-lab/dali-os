import type { Route } from "./+types/api.my-interview.reschedule";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson, idSchema } from "~/lib/validate";
import { assignInterviewers } from "~/hiring/lib/scheduling";
// import { provisionZoomMeeting, deprovisionZoomMeeting } from "~/lib/zoom"; // S2S Zoom not configured yet
import { provisionInterviewMeet, deprovisionInterviewMeet } from "~/hiring/lib/interview-meet";
import { sendInterviewCancelEmails, sendInterviewInviteEmails } from "~/hiring/lib/interview-emails";
import { notifyInterviewAssigned } from "~/hiring/lib/interview-notifications";

const RescheduleSchema = z
  .object({
    newStart: z.string().datetime({ offset: true }),
    newEnd: z.string().datetime({ offset: true }),
    domainApplicationId: idSchema,
    mode: z.enum(["in-person", "online"]).optional(),
  })
  .refine((v) => new Date(v.newEnd) > new Date(v.newStart), {
    message: "newEnd must be after newStart",
  });

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, RescheduleSchema);
  if (body instanceof Response) return withCors(request, body);
  const { newStart, newEnd, domainApplicationId, mode } = body;
  const interviewMode = mode === "in-person" ? "in-person" as const : "online" as const;

  // Cancel old + book new atomically inside a single serializable transaction.
  // If assignInterviewers throws (no free interviewers at the new slot), the
  // whole transaction rolls back and the old interview stays Scheduled.
  try {
    const { newInterview, oldInterviewId, oldCalendarEventId } = await prisma.$transaction(
      async (tx) => {
        const current = await tx.interview.findFirst({
          where: {
            domainApplicationId,
            domainApplication: { application: { userId: auth.user.sub } },
            status: "Scheduled",
          },
          include: {
            domainApplication: {
              include: {
                application: {
                  include: { domainApplications: { select: { domainId: true } } },
                },
              },
            },
          },
        });

        if (!current) {
          throw new Error("__NO_ACTIVE_INTERVIEW__");
        }

        const config = await tx.interviewConfig.findUnique({
          where: { applicationCycleId: current.applicationCycleId },
        });
        const rescheduleNoticeHours = config?.rescheduleNoticeHours ?? 12;
        const cutoff = new Date(current.startTime.getTime() - rescheduleNoticeHours * 60 * 60_000);
        if (new Date() > cutoff) {
          throw new Error("__TOO_LATE_TO_RESCHEDULE__");
        }

        const bookingNoticeHours = config?.bookingNoticeHours ?? 12;
        const earliestBookable = new Date(Date.now() + bookingNoticeHours * 60 * 60_000);
        if (new Date(newStart) < earliestBookable) {
          throw new Error("__TOO_SOON_TO_BOOK__");
        }

        // DomainApplication.domainId is authoritative and always set for
        // Standard cycles (the only cycleType that schedules interviews).
        const applicantDomainIds = current.domainApplication.application.domainApplications
          .map((da) => da.domainId)
          .filter((id): id is string => id !== null);

        await tx.interview.update({
          where: { id: current.id },
          data: { status: "CancelledByApplicant" },
        });
        // Release the old slot's assignments so it stops showing as an
        // active interview on interviewer dashboards — mirrors the cancel
        // and withdraw paths.
        await tx.interviewAssignment.updateMany({
          where: { interviewId: current.id, status: "Active" },
          data: { status: "Declined" },
        });

        const created = await assignInterviewers(
          current.applicationCycleId,
          current.domainApplicationId,
          applicantDomainIds,
          new Date(newStart),
          new Date(newEnd),
          tx,
          interviewMode,
        );

        return {
          newInterview: created,
          oldInterviewId: current.id,
          oldCalendarEventId: current.calendarEventId,
        };
      },
      { isolationLevel: "Serializable" },
    );

    // Move the Google Meet link with the interview: tear down the old slot's
    // event and mint a fresh one for the new slot before the invite email below
    // re-reads the row. Best-effort. Zoom S2S (app/lib/zoom.ts) stays dormant.
    await deprovisionInterviewMeet({ id: oldInterviewId, calendarEventId: oldCalendarEventId });
    await provisionInterviewMeet(newInterview.id);

    // Best-effort: cancel old calendar event + send new invite
    sendInterviewCancelEmails(oldInterviewId, domainApplicationId).catch(() => {});
    sendInterviewInviteEmails(newInterview.id, domainApplicationId).catch(() => {});
    notifyInterviewAssigned({
      assignmentIds: (newInterview.assignments ?? []).map((a) => a.id),
    }).catch(() => {});

    return withCors(request, Response.json(newInterview, { status: 201 }));
  } catch (err: any) {
    if (err?.message === "__NO_ACTIVE_INTERVIEW__") {
      return withCors(request, Response.json({ error: "No active interview found" }, { status: 404 }));
    }
    if (err?.message === "__TOO_LATE_TO_RESCHEDULE__") {
      return withCors(request, Response.json({ error: "Too late to reschedule — please contact the DALI team" }, { status: 403 }));
    }
    if (err?.message === "__TOO_SOON_TO_BOOK__") {
      return withCors(request, Response.json({ error: "That slot is too soon — pick a time further out" }, { status: 409 }));
    }
    return withCors(request, Response.json({ error: err?.message ?? "Failed to reschedule" }, { status: 409 }));
  }
}
