import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";
import { type GoogleAttendee } from "~/calendar/lib/google-calendar.server";
import { primaryEmail } from "~/lib/display";
import { APPLICATION_TZ, formatInstantWithZoneLabel, resolveUserTimeZone } from "~/lib/timezone";
import { buildIcs } from "~/lib/ics";
import { normalizeGuestEmails } from "~/calendar/lib/guest-emails";

export function meetingUid(meetingId: string): string {
  return `meeting-${meetingId}@dali.dartmouth.edu`;
}

// Invites go out with SEQUENCE:0 and cancels with SEQUENCE:1 — meetings have
// no intermediate ICS updates, so a persistent counter (interviews'
// icsSequence) isn't needed.
const ICS_SEQ_INVITE = 0;
const ICS_SEQ_CANCEL = 1;

// One ICS per recipient, listing only that recipient as attendee (same
// pattern as the applicant's interview ICS: nobody sees the full guest list).
export async function buildPerRecipientIcs(args: {
  meetingId: string;
  method: "REQUEST" | "CANCEL";
  title: string;
  startTime: Date;
  durationMinutes: number;
  organizerEmail: string;
  recurrenceRule: string | null;
  location?: string | null;
  description?: string | null;
  userIds: string[];
}): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({
    where: { id: { in: args.userIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      dartmouthEmail: true,
    },
  });
  const endTime = new Date(args.startTime.getTime() + args.durationMinutes * 60_000);
  const byUser = new Map<string, string>();
  for (const u of users) {
    const email = primaryEmail(u);
    if (!email) continue;
    byUser.set(
      u.id,
      buildIcs({
        uid: meetingUid(args.meetingId),
        method: args.method,
        summary: args.title,
        startTime: args.startTime,
        endTime,
        location: args.location ?? null,
        description: args.description ?? undefined,
        organizer: { email: args.organizerEmail, name: "DALI OS" },
        attendees: [{ email, name: `${u.firstName} ${u.lastName}`.trim() || email }],
        sequence: args.method === "CANCEL" ? ICS_SEQ_CANCEL : ICS_SEQ_INVITE,
        recurrenceRule: args.recurrenceRule,
      }),
    );
  }
  return byUser;
}

export async function googleAttendeesFor(
  userIds: string[],
  guestEmails: string[] = [],
): Promise<GoogleAttendee[]> {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      dartmouthEmail: true,
    },
  });
  const attendees: GoogleAttendee[] = [];
  for (const u of users) {
    const email = primaryEmail(u);
    if (!email) continue;
    attendees.push({ email, displayName: `${u.firstName} ${u.lastName}`.trim() || email });
  }
  for (const email of normalizeGuestEmails(guestEmails, attendees.map((a) => a.email))) {
    attendees.push({ email });
  }
  return attendees;
}

// The invite's body across all three channels. The ICS (and, for a Google-hosted
// meeting, Google's own invite) carries these fields too, but the in-app feed and
// the Slack DM have no attachment to open — so where and what the meeting is has
// to be in the message itself.
//
// `when` arrives already formatted in the recipient's own display zone, which is
// why the body is composed per recipient rather than once for the fan-out.
function inviteBody(
  when: string | null,
  location: string | null,
  description: string | null,
): string | null {
  const lines = [
    when ? `Starts ${when}` : null,
    location ? `Location: ${location}` : null,
    description || null,
  ].filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : null;
}

// The in-app/email/Slack invite for newly added guests. An ICS rides along only
// when we manage the invite ourselves — a Google-hosted meeting already gets a
// real invite from Google.
export async function sendMeetingInvites(args: {
  meetingId: string;
  actorUserId: string;
  title: string;
  startDate: Date | null;
  durationMinutes: number;
  recurrenceRule: string | null;
  ownerCalendarEmail: string;
  googleManaged: boolean;
  sourceGroupId: string | null;
  location: string | null;
  description: string | null;
  recipientIds: string[];
}): Promise<{ inApp: number }> {
  const icsByUser =
    args.startDate && !args.googleManaged
      ? await buildPerRecipientIcs({
          meetingId: args.meetingId,
          method: "REQUEST",
          title: args.title,
          startTime: args.startDate,
          durationMinutes: args.durationMinutes,
          organizerEmail: args.ownerCalendarEmail,
          recurrenceRule: args.recurrenceRule,
          location: args.location,
          description: args.description,
          userIds: args.recipientIds,
        })
      : null;
  // Each recipient's display zone, so the start reads in their own local time
  // with a zone label — the same resolution meeting reminders do.
  const tzRows = args.startDate
    ? await prisma.user.findMany({
        where: { id: { in: args.recipientIds } },
        select: { id: true, timeZone: true },
      })
    : [];
  const tzByUser = new Map(tzRows.map((r) => [r.id, resolveUserTimeZone(r)]));
  return notify({
    eventType: "meeting.invite",
    createdByUserId: args.actorUserId,
    message: {
      vars: { itemTitle: args.title },
      link: `/calendar?meeting=${args.meetingId}`,
      sourceGroupId: args.sourceGroupId,
      scheduledMeetingId: args.meetingId,
    },
    recipients: args.recipientIds.map((userId) => ({
      userId,
      vars: {
        itemDetail:
          inviteBody(
            args.startDate
              ? formatInstantWithZoneLabel(
                  args.startDate,
                  tzByUser.get(userId) ?? APPLICATION_TZ,
                )
              : null,
            args.location,
            args.description,
          ) ?? "",
      },
      ics: icsByUser?.get(userId) ?? null,
    })),
  });
}
