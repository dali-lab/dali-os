// Google Meet provisioning for online hiring interviews. Unlike the general
// scheduled-meeting path (where each organizer pushes to their own calendar and
// Google sends the invite), interviews are hosted on ONE shared hiring calendar
// so every invite comes "from" the hiring account. The event is created only to
// mint the Meet link and hold the hiring-calendar record — Google is kept silent
// (sendUpdates=none) because the templated interview emails
// (app/hiring/lib/interview-emails.ts) are still the single invite, now carrying
// the Meet link.
//
// Everything here is best-effort: an unconnected hiring account or a Google
// error never blocks booking / reschedule / cancel. The zoom*
// columns and app/lib/zoom.ts (the still-blocked S2S path) are untouched.

import { prisma } from "~/lib/db";
import type { Prisma } from "~/generated/prisma/client";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getGoogleEventMeetUrl,
  patchGoogleCalendarEvent,
  type GoogleAttendee,
  type GoogleCalendarAuth,
} from "~/lib/google-calendar";
import { getHiringCalendarSender, noteSenderHealth } from "~/lib/gmail-integration";
import { getGmailAccessToken } from "~/lib/gmail";

const HIRING_CALENDAR_EMAIL =
  process.env.HIRING_CALENDAR_EMAIL ?? "applications@dali.dartmouth.edu";

function errorMessage(err: unknown): string | null {
  return err == null ? null : err instanceof Error ? err.message : String(err);
}

// A Google failure on the shared hiring account (a revoked token, a lost
// Calendar scope) would otherwise only reach the server log while every online
// interview quietly went out without a link. The error lands on whichever row
// supplied the token, where its admin card already renders syncError; a later
// success clears it.
async function recordLinkHealth(linkId: string, err: unknown): Promise<void> {
  const syncError = errorMessage(err);
  await prisma.userCalendarLink
    .update({ where: { id: linkId }, data: { syncError, ...(syncError ? {} : { lastSyncedAt: new Date() }) } })
    .catch(() => {});
}

export type HiringCalendar = {
  auth: GoogleCalendarAuth;
  recordHealth: (err: unknown) => Promise<void>;
};

// The Hiring sender (Admin → Email senders) already signs in as applications@
// with Calendar access, so it is the account admins actually connect. A
// calendar link on that address is the older route and still works.
export async function getHiringCalendar(): Promise<HiringCalendar | null> {
  const sender = await getHiringCalendarSender(HIRING_CALENDAR_EMAIL);
  if (sender) {
    const recordHealth = (err: unknown) => noteSenderHealth(sender.id, errorMessage(err));
    try {
      return { auth: { accessToken: await getGmailAccessToken(sender.refreshToken) }, recordHealth };
    } catch (err) {
      console.error("Failed to refresh the Hiring sender token for Meet:", err);
      await recordHealth(err);
      return null;
    }
  }
  const link = await prisma.userCalendarLink.findFirst({
    where: { provider: "Google", enabled: true, externalEmail: HIRING_CALENDAR_EMAIL },
    select: { id: true },
    orderBy: { linkedAt: "asc" },
  });
  if (!link) return null;
  return { auth: { linkId: link.id }, recordHealth: (err) => recordLinkHealth(link.id, err) };
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
// storing the join URL and event id on the row. No-op unless the hiring calendar
// is connected, the interview is Online, and it hasn't already been provisioned. Await before sending the invite emails so they
// re-read the row with the link present.
export async function provisionInterviewMeet(interviewId: string): Promise<void> {
  const cal = await getHiringCalendar();
  if (!cal) return;
  try {
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: MEET_INCLUDE,
    });
    // Online only, and only once — a re-run (idempotent lease recovery, a double
    // click) must not mint a second conference.
    if (!interview || interview.roomId !== null || interview.calendarEventId) return;

    const attendees = meetAttendees(interview);
    if (attendees.length === 0) return;

    const domainName = interview.domainApplication.domain?.name ?? "DALI Lab";
    const result = await createGoogleCalendarEvent({
      ...cal.auth,
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

    // meetUrl may still be null here (Google mints the conference after the
    // insert returns); ensureInterviewMeetUrl picks it up on the next read.
    await prisma.interview.update({
      where: { id: interviewId },
      data: {
        calendarEventId: result.eventId,
        videoUrl: result.meetUrl,
        videoProvider: "GoogleMeet",
      },
    });
    await cal.recordHealth(null);
  } catch (err) {
    console.error("Failed to provision interview Meet:", err);
    await cal.recordHealth(err);
  }
}

// Fill in a Meet link that wasn't ready when the event was created. No-op
// unless the interview has an event but no link. Returns the link, if any, so
// callers that are about to render or email it can use the fresh value.
export async function ensureInterviewMeetUrl(interview: {
  id: string;
  calendarEventId: string | null;
  videoUrl: string | null;
}): Promise<string | null> {
  if (interview.videoUrl || !interview.calendarEventId) return interview.videoUrl;
  const cal = await getHiringCalendar();
  if (!cal) return null;
  try {
    const meetUrl = await getGoogleEventMeetUrl({ ...cal.auth, eventId: interview.calendarEventId });
    if (!meetUrl) return null;
    await prisma.interview.update({
      where: { id: interview.id },
      data: { videoUrl: meetUrl, videoProvider: "GoogleMeet" },
    });
    await cal.recordHealth(null);
    return meetUrl;
  } catch (err) {
    console.error("Failed to read interview Meet link:", err);
    await cal.recordHealth(err);
    return null;
  }
}

// Delete the hiring-calendar event and clear the row's link fields. Used on
// cancel, on reschedule (for the old interview), and when an interview switches
// from Online to a physical pod.
export async function deprovisionInterviewMeet(interview: {
  id: string;
  calendarEventId: string | null;
}): Promise<void> {
  if (!interview.calendarEventId) return;
  const cal = await getHiringCalendar();
  try {
    if (cal) {
      await deleteGoogleCalendarEvent({ ...cal.auth, eventId: interview.calendarEventId });
    }
    await prisma.interview.update({
      where: { id: interview.id },
      data: { calendarEventId: null, videoUrl: null, videoProvider: null },
    });
    if (cal) await cal.recordHealth(null);
  } catch (err) {
    console.error("Failed to deprovision interview Meet:", err);
    if (cal) await cal.recordHealth(err);
  }
}

// Re-push the guest list onto an existing Meet event after an interviewer swap,
// so the replacement is a recognized guest (no knock) and the old one drops off.
// No-op when the interview has no Meet event.
export async function syncInterviewMeetAttendees(interviewId: string): Promise<void> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: MEET_INCLUDE,
  });
  if (!interview?.calendarEventId) return;
  const cal = await getHiringCalendar();
  if (!cal) return;
  try {
    await patchGoogleCalendarEvent({
      ...cal.auth,
      eventId: interview.calendarEventId,
      attendees: meetAttendees(interview),
      sendUpdates: "none",
    });
    await cal.recordHealth(null);
  } catch (err) {
    console.error("Failed to sync interview Meet attendees:", err);
    await cal.recordHealth(err);
  }
}
