// Google Meet provisioning for online hiring interviews. Unlike the general
// scheduled-meeting path (where each organizer pushes to their own calendar and
// Google sends the invite), interviews are hosted on ONE shared hiring calendar
// so every invite comes "from" the hiring account. The event is created only to
// mint the Meet link and hold the hiring-calendar record — Google is kept silent
// (sendUpdates=none) because the templated interview emails
// (app/hiring/lib/interview-emails.ts) are still the single invite, now carrying
// the Meet link.
//
// Everything here is best-effort: a missing hiring calendar link, the flag being
// off, or a Google error never blocks booking / reschedule / cancel. The zoom*
// columns and app/lib/zoom.ts (the still-blocked S2S path) are untouched.

import { prisma } from "~/lib/db";
import type { Prisma } from "~/generated/prisma/client";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  patchGoogleCalendarEvent,
  type GoogleAttendee,
} from "~/lib/google-calendar";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";

// The shared Google account interview events are hosted on. An admin links it
// once through the normal calendar-connect flow; we resolve it by email so no
// extra config table is needed. Override via env for non-DALI deployments.
const HIRING_CALENDAR_EMAIL =
  process.env.HIRING_CALENDAR_EMAIL ?? "applications@dali.dartmouth.edu";

/** The enabled Google calendar link for the shared hiring account, or null when
 *  it hasn't been connected yet (in which case interviews simply get no Meet
 *  link). */
export async function getHiringCalendarLink(): Promise<{ id: string } | null> {
  return prisma.userCalendarLink.findFirst({
    where: {
      provider: "Google",
      enabled: true,
      externalEmail: HIRING_CALENDAR_EMAIL,
    },
    select: { id: true },
    orderBy: { linkedAt: "asc" },
  });
}

const MEET_INCLUDE = {
  domainApplication: {
    include: {
      domain: { select: { name: true } },
      application: {
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              dartmouthEmail: true,
              netId: true,
            },
          },
        },
      },
    },
  },
  assignments: {
    where: { status: "Active" as const },
    include: {
      cycleInterviewer: {
        include: {
          user: {
            select: { firstName: true, lastName: true, daliEmail: true },
          },
        },
      },
    },
  },
} satisfies Prisma.InterviewInclude;

type InterviewWithMeet = Prisma.InterviewGetPayload<{ include: typeof MEET_INCLUDE }>;

// The applicant is invited on their Dartmouth address (interviewers on their
// dali one) — matches the recipients the interview emails already use, so the
// guest list and the emailed invite name the same people.
function meetAttendees(interview: InterviewWithMeet): GoogleAttendee[] {
  const out: GoogleAttendee[] = [];
  const applicant = interview.domainApplication.application.user;
  const applicantEmail =
    applicant.dartmouthEmail ?? (applicant.netId ? `${applicant.netId}@dartmouth.edu` : null);
  if (applicantEmail) {
    out.push({
      email: applicantEmail,
      displayName: `${applicant.firstName} ${applicant.lastName}`.trim() || applicantEmail,
    });
  }
  for (const a of interview.assignments) {
    const u = a.cycleInterviewer.user;
    if (u?.daliEmail) {
      out.push({
        email: u.daliEmail,
        displayName: `${u.firstName} ${u.lastName}`.trim() || u.daliEmail,
      });
    }
  }
  return out;
}

// Create the hiring-calendar event + Meet link for a freshly online interview,
// storing the join URL and event id on the row. No-op unless the feature is live
// for everyone, the hiring calendar is connected, the interview is Online, and it
// hasn't already been provisioned. Await before sending the invite emails so they
// re-read the row with the link present.
export async function provisionInterviewMeet(interviewId: string): Promise<void> {
  try {
    if (!(await isFeatureEnabledForEveryone("google-meet"))) return;
    const link = await getHiringCalendarLink();
    if (!link) return;

    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: MEET_INCLUDE,
    });
    // Online only, and only once — a re-run (idempotent lease recovery, a double
    // click) must not mint a second conference.
    if (!interview || interview.location !== "Online" || interview.calendarEventId) return;

    const attendees = meetAttendees(interview);
    if (attendees.length === 0) return;

    const domainName = interview.domainApplication.domain?.name ?? "DALI Lab";
    const result = await createGoogleCalendarEvent({
      linkId: link.id,
      summary: `DALI Interview — ${domainName}`,
      startIso: interview.startTime.toISOString(),
      endIso: interview.endTime.toISOString(),
      attendees,
      addMeet: true,
      // The templated interview email is the invite; Google stays silent so
      // there's no duplicate. Attendees are still on the event so same-domain
      // guests join without a knock.
      sendUpdates: "none",
    });

    await prisma.interview.update({
      where: { id: interviewId },
      data: {
        calendarEventId: result.eventId,
        videoUrl: result.meetUrl,
        videoProvider: "GoogleMeet",
      },
    });
  } catch (err) {
    console.error("Failed to provision interview Meet:", err);
  }
}

// Delete the hiring-calendar event and clear the row's link fields. Used on
// cancel, on reschedule (for the old interview), and when an interview switches
// from Online to a physical pod.
export async function deprovisionInterviewMeet(interview: {
  id: string;
  calendarEventId: string | null;
}): Promise<void> {
  try {
    if (!interview.calendarEventId) return;
    const link = await getHiringCalendarLink();
    if (link) {
      await deleteGoogleCalendarEvent({ linkId: link.id, eventId: interview.calendarEventId });
    }
    await prisma.interview.update({
      where: { id: interview.id },
      data: { calendarEventId: null, videoUrl: null, videoProvider: null },
    });
  } catch (err) {
    console.error("Failed to deprovision interview Meet:", err);
  }
}

// Re-push the guest list onto an existing Meet event after an interviewer swap,
// so the replacement is a recognized guest (no knock) and the old one drops off.
// No-op when the interview has no Meet event.
export async function syncInterviewMeetAttendees(interviewId: string): Promise<void> {
  try {
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: MEET_INCLUDE,
    });
    if (!interview?.calendarEventId) return;
    const link = await getHiringCalendarLink();
    if (!link) return;

    await patchGoogleCalendarEvent({
      linkId: link.id,
      eventId: interview.calendarEventId,
      attendees: meetAttendees(interview),
      sendUpdates: "none",
    });
  } catch (err) {
    console.error("Failed to sync interview Meet attendees:", err);
  }
}
