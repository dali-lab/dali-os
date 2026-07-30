import { prisma } from "~/lib/db";
import { getFrontendUrl } from "~/lib/app-env";
import { buildIcs } from "~/lib/ics";
import { notify } from "~/lib/notify.server";
import { currentTerm } from "~/lib/roles";
import { activeProjectPartnerWhere } from "./partner-access";
import {
  sendPartnerMeetingSharedEmail,
  sendPartnerMeetingUpdatedEmail,
} from "./partner-emails.server";

// Partner delivery for shared meetings. A partner-visible ScheduledMeeting is
// delivered as a standard calendar-invite email (an .ics attachment) to every
// user of every org with an active partnership on the meeting's project —
// works in any calendar app, needs no partner OAuth. Partner attendees stay
// OUT of the meeting's member roster (participantUserIds); RSVP is handled in
// the portal (see partner.meetings.$id.rsvp). Everything here is best-effort.

type Recipient = { userId: string; name: string; email: string };

async function partnerRecipientsForProject(
  projectId: string,
): Promise<Recipient[]> {
  const links = await prisma.projectPartner.findMany({
    where: { projectId, ...activeProjectPartnerWhere() },
    select: {
      partnerOrg: {
        select: {
          users: {
            select: {
              userId: true,
              user: {
                select: { firstName: true, lastName: true, personalEmail: true },
              },
            },
          },
        },
      },
    },
  });
  const byUser = new Map<string, Recipient>();
  for (const l of links) {
    for (const u of l.partnerOrg.users) {
      const email = u.user.personalEmail;
      if (!email) continue;
      byUser.set(u.userId, {
        userId: u.userId,
        name: [u.user.firstName, u.user.lastName].filter(Boolean).join(" ") || email,
        email,
      });
    }
  }
  return [...byUser.values()];
}

function formatWhen(start: Date): string {
  return (
    start.toLocaleString("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "America/New_York",
    }) + " ET"
  );
}

type ShareableMeeting = {
  id: string;
  title: string;
  selectedAt: Date | null;
  durationMinutes: number;
  recurrenceRule: string | null;
  projectId: string | null;
  partnerVisible: boolean;
  ownerCalendarEmail: string;
  status: string;
  project: { name: string } | null;
};

async function loadMeeting(meetingId: string): Promise<ShareableMeeting | null> {
  return prisma.scheduledMeeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      title: true,
      selectedAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      projectId: true,
      partnerVisible: true,
      ownerCalendarEmail: true,
      status: true,
      project: { select: { name: true } },
    },
  });
}

// Fire when a meeting becomes partner-visible (created shared, or toggled on).
export async function sharePartnerMeeting(meetingId: string): Promise<void> {
  try {
    const m = await loadMeeting(meetingId);
    if (!m || !m.partnerVisible || !m.projectId || m.status === "Cancelled") return;
    // Nothing to invite to until a time is picked; the portal still lists it.
    if (!m.selectedAt) return;
    const recipients = await partnerRecipientsForProject(m.projectId);
    if (recipients.length === 0) return;

    const projectName = m.project?.name ?? "your project";
    const viewUrl = `${getFrontendUrl()}/partner/projects/${m.projectId}`;
    const when = formatWhen(m.selectedAt);
    const start = m.selectedAt;
    const end = new Date(start.getTime() + m.durationMinutes * 60_000);

    await Promise.allSettled(
      recipients.map((r) => {
        const ics = buildIcs({
          uid: `dali-partner-meeting-${m.id}`,
          method: "REQUEST",
          summary: m.title,
          startTime: start,
          endTime: end,
          organizer: { email: m.ownerCalendarEmail, name: "DALI OS" },
          attendees: [{ email: r.email, name: r.name }],
          sequence: 0,
          recurrenceRule: m.recurrenceRule,
        });
        return sendPartnerMeetingSharedEmail(
          r.email,
          m.title,
          projectName,
          when,
          viewUrl,
          ics,
        );
      }),
    );
  } catch (err) {
    console.error("sharePartnerMeeting failed", err);
  }
}

// Fire when a shared meeting is rescheduled (cancelled=false) or cancelled.
export async function notifyPartnerMeetingUpdated(
  meetingId: string,
  cancelled: boolean,
): Promise<void> {
  try {
    const m = await loadMeeting(meetingId);
    // Only meetings that were actually shared reach partners.
    if (!m || !m.partnerVisible || !m.projectId) return;
    if (!m.selectedAt) return;
    const recipients = await partnerRecipientsForProject(m.projectId);
    if (recipients.length === 0) return;

    const projectName = m.project?.name ?? "your project";
    const viewUrl = `${getFrontendUrl()}/partner/projects/${m.projectId}`;
    const when = formatWhen(m.selectedAt);
    const start = m.selectedAt;
    const end = new Date(start.getTime() + m.durationMinutes * 60_000);

    await Promise.allSettled(
      recipients.map((r) => {
        const ics = buildIcs({
          uid: `dali-partner-meeting-${m.id}`,
          method: cancelled ? "CANCEL" : "REQUEST",
          summary: m.title,
          startTime: start,
          endTime: end,
          organizer: { email: m.ownerCalendarEmail, name: "DALI OS" },
          attendees: [{ email: r.email, name: r.name }],
          sequence: cancelled ? 2 : 1,
          recurrenceRule: m.recurrenceRule,
        });
        return sendPartnerMeetingUpdatedEmail(
          r.email,
          m.title,
          projectName,
          cancelled,
          when,
          viewUrl,
          ics,
        );
      }),
    );
  } catch (err) {
    console.error("notifyPartnerMeetingUpdated failed", err);
  }
}

// A partner asks their project team for a meeting: record it and notify the
// project's current-term assignees (they're members, so notify() applies).
export async function requestPartnerMeeting(params: {
  projectId: string;
  partnerOrgId: string;
  requestedByUserId: string;
  topic: string;
  details: string | null;
  preferredWindows: string | null;
}): Promise<void> {
  await prisma.partnerMeetingRequest.create({ data: { ...params, status: "Open" } });
  try {
    const [project, org, term] = await Promise.all([
      prisma.project.findUnique({
        where: { id: params.projectId },
        select: { name: true },
      }),
      prisma.partnerOrg.findUnique({
        where: { id: params.partnerOrgId },
        select: { name: true },
      }),
      currentTerm(),
    ]);
    const assignees = term
      ? await prisma.projectAssignment.findMany({
          where: { projectId: params.projectId, termId: term.id },
          select: { userId: true },
        })
      : [];
    const recipientIds = [...new Set(assignees.map((a) => a.userId))];
    if (recipientIds.length === 0) return;
    await notify({
      eventType: "partner.meeting.requested",
      createdByUserId: params.requestedByUserId,
      message: {
        title: `Meeting request from ${org?.name ?? "a partner"}`,
        body: `${params.topic}${params.preferredWindows ? ` · Preferred: ${params.preferredWindows}` : ""} — ${project?.name ?? "project"}`,
        link: `/projects/${params.projectId}`,
      },
      recipients: recipientIds.map((userId) => ({ userId })),
    });
  } catch (err) {
    console.error("requestPartnerMeeting notify failed", err);
  }
}
