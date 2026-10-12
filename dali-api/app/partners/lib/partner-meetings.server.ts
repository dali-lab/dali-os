// Partner CRM scheduling: the server-side half of specs/partner-crm.md §6.
// Three flows:
//   - Core schedules an interview (CreateEventModal via ScheduleInterviewModal)
//     and links the resulting ScheduledMeeting back to the application —
//     linkScheduledMeetingToApplication.
//   - A partner requests a meeting from the portal's real-scheduler grid —
//     createMeetingRequest.
//   - Core accepts or declines that request — respondToMeetingRequest.
// listPartnerMeetingsForContact and resolveMeetingParticipantIds are read-only
// helpers the API routes and portal loaders share.

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { createScheduledMeeting } from "~/lib/scheduled-meeting";
import { computeUserFreeBusy, type Interval } from "~/lib/availability";
import { logPartnerActivity } from "~/partners/lib/partner-activity.server";
import { notifyPartners, partnerNotifyRecipients } from "~/partners/lib/partner-notify.server";
import { sendMeetingRequestDeclinedEmail } from "~/partners/lib/partner-emails.server";

export type PartnerMeetingSummary = {
  id: string;
  title: string;
  startTime: string;
  durationMinutes: number;
  meetingUrl: string | null;
};

export type PartnerMeetingRequestSummary = {
  id: string;
  startTime: string;
  durationMinutes: number;
  status: "Pending" | "Declined" | "Expired";
  note: string | null;
  responseNote: string | null;
};

// ── Linking a real ScheduledMeeting to an application ───────────────────────

/**
 * Creates the PartnerMeeting CRM-link row for a ScheduledMeeting that was
 * just created (by Core's scheduler or by accepting a request), clears the
 * application's pending-request flag, and logs MeetingScheduled. When
 * `requestId` is given (the accept path), also resolves that request.
 */
export async function linkScheduledMeetingToApplication(input: {
  applicationId: string;
  scheduledMeetingId: string;
  actorUserId: string | null;
  requestId?: string | null;
}): Promise<{ id: string; scheduledAt: Date } | null> {
  const [application, meeting] = await Promise.all([
    prisma.partnerApplication.findUnique({
      where: { id: input.applicationId },
      select: { id: true, applicantContactId: true },
    }),
    prisma.scheduledMeeting.findUnique({
      where: { id: input.scheduledMeetingId },
      select: { id: true, selectedAt: true, participantUserIds: true, meetingUrl: true },
    }),
  ]);
  if (!application || !meeting) return null;

  const scheduledAt = meeting.selectedAt ?? new Date();

  return prisma.$transaction(async (tx) => {
    const row = await tx.partnerMeeting.create({
      data: {
        applicationId: input.applicationId,
        scheduledAt,
        attendeeUserIds: meeting.participantUserIds,
        contactId: application.applicantContactId ?? null,
        scheduledMeetingId: meeting.id,
      },
      select: { id: true, scheduledAt: true },
    });

    await tx.partnerApplication.updateMany({
      where: { id: input.applicationId },
      data: { meetingRequestedAt: null },
    });

    await logPartnerActivity(tx, {
      applicationId: input.applicationId,
      actorUserId: input.actorUserId,
      type: "MeetingScheduled",
      metadata: { scheduledMeetingId: meeting.id, meetingUrl: meeting.meetingUrl ?? null },
    });

    if (input.requestId) {
      await tx.partnerMeetingRequest.updateMany({
        where: { id: input.requestId },
        data: {
          status: "Accepted",
          scheduledMeetingId: meeting.id,
          respondedByUserId: input.actorUserId,
          respondedAt: new Date(),
        },
      });
    }

    return row;
  });
}

// ── Resolving who a meeting request's availability grid shows ──────────────

/**
 * The team a partner sees mutual availability for: the interview panel
 * (PartnerCrmSettings, default all active Core) for an application, or the
 * project's current-term assignments for a project page.
 */
export async function resolveMeetingParticipantIds(scope: {
  applicationId?: string | null;
  projectId?: string | null;
}): Promise<string[]> {
  if (scope.applicationId) {
    const settings = await prisma.partnerCrmSettings.findUnique({
      where: { id: "default" },
      select: { interviewPanelUserIds: true },
    });
    if (settings?.interviewPanelUserIds && settings.interviewPanelUserIds.length > 0) {
      return settings.interviewPanelUserIds;
    }
    return partnerNotifyRecipients();
  }
  if (scope.projectId) {
    const term = await currentTerm();
    if (!term) return [];
    const rows = await prisma.projectAssignment.findMany({
      where: { projectId: scope.projectId, termId: term.id },
      select: { userId: true },
    });
    return Array.from(new Set(rows.map((r) => r.userId)));
  }
  return [];
}

async function resolveNotifyLink(scope: {
  applicationId?: string | null;
  projectId?: string | null;
}): Promise<string | null> {
  if (scope.applicationId) return `/core/partners?application=${scope.applicationId}`;
  if (scope.projectId) {
    const link = await prisma.projectPartner.findFirst({
      where: { projectId: scope.projectId },
      select: { partnerOrgId: true },
    });
    return link ? `/core/partners/orgs/${link.partnerOrgId}` : null;
  }
  return null;
}

// ── A partner requests a meeting from the portal grid ───────────────────────

export async function createMeetingRequest(input: {
  contactId: string;
  applicationId?: string | null;
  projectId?: string | null;
  startTime: Date;
  durationMinutes: number;
  note?: string | null;
}): Promise<{ id: string }> {
  const participantUserIds = await resolveMeetingParticipantIds({
    applicationId: input.applicationId ?? null,
    projectId: input.projectId ?? null,
  });
  const note = input.note?.trim() || null;

  const request = await prisma.partnerMeetingRequest.create({
    data: {
      applicationId: input.applicationId ?? null,
      projectId: input.projectId ?? null,
      contactId: input.contactId,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes,
      participantUserIds,
      note,
    },
    select: { id: true },
  });

  if (input.applicationId) {
    await prisma.partnerApplication.updateMany({
      where: { id: input.applicationId },
      data: { meetingRequestedAt: new Date() },
    });
  }

  await logPartnerActivity(prisma, {
    applicationId: input.applicationId ?? null,
    contactId: input.contactId,
    type: "MeetingRequested",
    metadata: { requestId: request.id, startTime: input.startTime.toISOString() },
  });

  await notifyPartners({
    eventType: "partner.meeting_requested",
    title: "New meeting request",
    body: note,
    link: await resolveNotifyLink(input),
    dedupKey: `partner.meeting_requested:${request.id}`,
  });

  return { id: request.id };
}

// ── Core responds to a request ──────────────────────────────────────────────

function isFreeForWindow(free: Interval[], start: Date, end: Date): boolean {
  const sorted = [...free].sort((a, b) => a.start.getTime() - b.start.getTime());
  let cursor = start.getTime();
  const endMs = end.getTime();
  for (const iv of sorted) {
    if (iv.end.getTime() <= cursor) continue;
    if (iv.start.getTime() > cursor) break;
    cursor = Math.max(cursor, iv.end.getTime());
    if (cursor >= endMs) break;
  }
  return cursor >= endMs;
}

export type RespondToMeetingRequestResult =
  | { ok: true; conflict?: true; busyUserIds?: string[]; scheduledMeetingId?: string }
  | { ok: false; error: string };

export async function respondToMeetingRequest(input: {
  requestId: string;
  actorUserId: string;
  action: "accept" | "decline";
  note?: string | null;
}): Promise<RespondToMeetingRequestResult> {
  const request = await prisma.partnerMeetingRequest.findUnique({
    where: { id: input.requestId },
    include: { contact: { select: { id: true, name: true, email: true } } },
  });
  if (!request) return { ok: false, error: "Meeting request not found" };
  if (request.status !== "Pending") {
    return { ok: false, error: "This request has already been handled" };
  }

  if (input.action === "decline") {
    const responseNote = input.note?.trim() || null;
    await prisma.$transaction(async (tx) => {
      await tx.partnerMeetingRequest.update({
        where: { id: request.id },
        data: {
          status: "Declined",
          responseNote,
          respondedByUserId: input.actorUserId,
          respondedAt: new Date(),
        },
      });
      await logPartnerActivity(tx, {
        applicationId: request.applicationId,
        contactId: request.contactId,
        actorUserId: input.actorUserId,
        type: "MeetingRequestDeclined",
        metadata: { requestId: request.id, note: responseNote },
      });
    });
    await sendMeetingRequestDeclinedEmail(request.contact.email, request.contact.name, responseNote);
    return { ok: true };
  }

  // accept
  const [organizer, link] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.actorUserId },
      select: { daliEmail: true, dartmouthEmail: true },
    }),
    prisma.userCalendarLink.findFirst({
      where: { userId: input.actorUserId, provider: "Google", enabled: true },
      orderBy: { linkedAt: "asc" },
      select: { id: true },
    }),
  ]);
  const organizerEmail = organizer?.daliEmail ?? organizer?.dartmouthEmail;
  if (!organizerEmail) {
    return { ok: false, error: "You have no email on file to organize this meeting" };
  }

  const windowEnd = new Date(request.startTime.getTime() + request.durationMinutes * 60_000);
  const perUser = request.participantUserIds.length
    ? await Promise.all(
        request.participantUserIds.map((uid) => computeUserFreeBusy(uid, request.startTime, windowEnd)),
      )
    : [];
  const busyUserIds = perUser
    .filter((u) => !isFreeForWindow(u.free, request.startTime, windowEnd))
    .map((u) => u.userId);
  const conflict = busyUserIds.length > 0;

  const created = await createScheduledMeeting({
    organizerId: input.actorUserId,
    organizerEmail,
    title: `DALI x ${request.contact.name}`,
    durationMinutes: request.durationMinutes,
    scope: { type: "UserList", participantUserIds: request.participantUserIds },
    startTime: request.startTime.toISOString(),
    organizerCalendarLinkId: link?.id,
    guestEmails: [request.contact.email],
    addMeet: true,
  });
  if (!created.ok) return { ok: false, error: created.error };

  if (request.applicationId) {
    await linkScheduledMeetingToApplication({
      applicationId: request.applicationId,
      scheduledMeetingId: created.meeting.id,
      actorUserId: input.actorUserId,
      requestId: request.id,
    });
  } else {
    // Project-scoped request: no PartnerApplication to link — resolve the
    // request itself and log on the contact/org timeline directly.
    await prisma.$transaction(async (tx) => {
      await tx.partnerMeetingRequest.update({
        where: { id: request.id },
        data: {
          status: "Accepted",
          scheduledMeetingId: created.meeting.id,
          respondedByUserId: input.actorUserId,
          respondedAt: new Date(),
        },
      });
      await logPartnerActivity(tx, {
        contactId: request.contactId,
        actorUserId: input.actorUserId,
        type: "MeetingScheduled",
        metadata: {
          scheduledMeetingId: created.meeting.id,
          meetingUrl: created.meeting.meetingUrl ?? null,
          projectId: request.projectId,
        },
      });
    });
  }

  return {
    ok: true,
    ...(conflict ? { conflict: true as const, busyUserIds } : {}),
    scheduledMeetingId: created.meeting.id,
  };
}

// ── Read helpers for the portal ─────────────────────────────────────────────

/** Upcoming ScheduledMeetings the contact is a guest on, across every
 *  application/project — shown in the portal's Meetings section. */
export async function listPartnerMeetingsForContact(
  contactEmail: string,
): Promise<PartnerMeetingSummary[]> {
  const rows = await prisma.scheduledMeeting.findMany({
    where: {
      guestEmails: { has: contactEmail.toLowerCase() },
      status: { not: "Cancelled" },
      selectedAt: { gte: new Date() },
    },
    orderBy: { selectedAt: "asc" },
    select: { id: true, title: true, selectedAt: true, durationMinutes: true, meetingUrl: true },
  });
  return rows
    .filter((r): r is typeof r & { selectedAt: Date } => r.selectedAt !== null)
    .map((r) => ({
      id: r.id,
      title: r.title,
      startTime: r.selectedAt.toISOString(),
      durationMinutes: r.durationMinutes,
      meetingUrl: r.meetingUrl,
    }));
}

/** Pending and declined requests for one application or project, for the
 *  portal's Meetings section (and Core's modal Meetings tab). */
export async function listPartnerMeetingRequests(scope: {
  applicationId?: string | null;
  projectId?: string | null;
}): Promise<{ pending: PartnerMeetingRequestSummary[]; declined: PartnerMeetingRequestSummary[] }> {
  const rows = await prisma.partnerMeetingRequest.findMany({
    where: {
      ...(scope.applicationId ? { applicationId: scope.applicationId } : {}),
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
      status: { in: ["Pending", "Declined"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      startTime: true,
      durationMinutes: true,
      status: true,
      note: true,
      responseNote: true,
    },
  });
  const toSummary = (r: (typeof rows)[number]): PartnerMeetingRequestSummary => ({
    id: r.id,
    startTime: r.startTime.toISOString(),
    durationMinutes: r.durationMinutes,
    status: r.status as "Pending" | "Declined",
    note: r.note,
    responseNote: r.responseNote,
  });
  return {
    pending: rows.filter((r) => r.status === "Pending").map(toSummary),
    declined: rows.filter((r) => r.status === "Declined").map(toSummary),
  };
}
