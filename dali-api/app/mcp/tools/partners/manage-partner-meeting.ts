// MCP tool: manage_partner_meeting — log and debrief partner meetings.
// Scope: mcp:write. Gated to isCore.
//
// Actions:
//   create  — three ways to create a PartnerMeeting row for an application:
//             (a) scheduledMeetingId — link an already-created ScheduledMeeting
//                 (routes through linkScheduledMeetingToApplication, the same
//                 helper the web scheduler uses).
//             (b) startTime + participantUserIds — create a real
//                 ScheduledMeeting (Google invite + Meet link when the caller
//                 has a linked calendar) and link it, same as (a).
//             (c) scheduledAt (legacy) — a bare log row with no ScheduledMeeting
//                 behind it, for a meeting that didn't go through the real
//                 scheduler. Accepts optional attendeeUserIds / notes.
//             None of these email the partner directly — Google's own invite
//             does for (a)/(b); (c) stays silent, matching the no-email rule.
//   debrief — set debrief text and/or outcome on an existing meeting (mirrors meeting-debrief intent).
//
// Web fns reused: logPartnerActivity (from partner-activity.server) for the
// MeetingDebriefed activity row, and linkScheduledMeetingToApplication /
// createScheduledMeeting (from partner-meetings.server / scheduled-meeting)
// for the (a)/(b) create paths. The legacy (c) path and debrief stay direct
// Prisma calls, same as the original web action.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { logPartnerActivity } from "~/partners/lib/partner-activity.server";
import { linkScheduledMeetingToApplication } from "~/partners/lib/partner-meetings.server";
import { createScheduledMeeting } from "~/lib/scheduled-meeting";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  requireForAction,
} from "../../registry";

const VALID_OUTCOMES = ["Advance", "Hold", "Reject", "MoreInfoNeeded"] as const;
type MeetingOutcome = (typeof VALID_OUTCOMES)[number];

export const MANAGE_PARTNER_MEETING_TOOL = {
  name: "manage_partner_meeting",
  description:
    "Log and debrief discovery/partner meetings (Core only). " +
    "create (applicationId required) takes exactly one of: scheduledMeetingId (link an existing ScheduledMeeting), " +
    "startTime+participantUserIds (create a real ScheduledMeeting via the calendar and link it; optional durationMinutes default 30, title default 'DALI x <contact>', guestEmails default the applicant's email), " +
    "or scheduledAt (legacy log-only row, no ScheduledMeeting; attendeeUserIds/notes optional) — none of these email the partner directly. " +
    "debrief (meetingId+applicationId required; debrief text and/or outcome: Advance|Hold|Reject|MoreInfoNeeded).",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "debrief"],
        description: "What to do.",
      },
      applicationId: {
        type: "string",
        description: "PartnerApplication id. Required for both actions.",
      },
      scheduledMeetingId: {
        type: "string",
        description: "Link this already-created ScheduledMeeting.id to the application (create).",
      },
      startTime: {
        type: "string",
        description: "ISO 8601 start time — creates a real ScheduledMeeting via the calendar (create).",
      },
      participantUserIds: {
        type: "array",
        items: { type: "string" },
        description: "DALI member user ids to invite — required alongside startTime (create).",
      },
      durationMinutes: {
        type: "integer",
        minimum: 5,
        maximum: 480,
        description: "Meeting length when creating via startTime (create). Defaults to 30.",
      },
      title: {
        type: "string",
        description: "Meeting title when creating via startTime (create). Defaults to 'DALI x <contact name>'.",
      },
      guestEmails: {
        type: "array",
        items: { type: "string" },
        description: "Guest emails when creating via startTime (create). Defaults to the applicant contact's email.",
      },
      scheduledAt: {
        type: "string",
        description:
          "ISO 8601 datetime for a legacy log-only meeting with no ScheduledMeeting behind it (create).",
      },
      attendeeUserIds: {
        type: "array",
        items: { type: "string" },
        description: "User ids of Core attendees (create via scheduledAt, optional).",
      },
      notes: {
        type: "string",
        description: "Pre-meeting notes or agenda (create via scheduledAt, optional).",
      },
      meetingId: {
        type: "string",
        description: "PartnerMeeting id (required for debrief).",
      },
      debrief: {
        type: "string",
        description: "Post-meeting debrief text (debrief).",
      },
      outcome: {
        type: "string",
        enum: VALID_OUTCOMES as unknown as string[],
        description: "Meeting outcome (debrief): Advance, Hold, Reject, or MoreInfoNeeded.",
      },
    },
    required: ["action", "applicationId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runManagePartnerMeeting(
  callerId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can manage partner meetings");
  }

  const action = input.action as string;

  requireForAction(action, input, {
    create: ["applicationId"],
    debrief: ["applicationId", "meetingId"],
  });

  // ── create ────────────────────────────────────────────────────────────────
  if (action === "create") {
    const applicationId = input.applicationId as string;

    const scheduledMeetingId =
      typeof input.scheduledMeetingId === "string" ? input.scheduledMeetingId.trim() : null;
    const startTimeRaw = typeof input.startTime === "string" ? input.startTime.trim() : null;
    const participantUserIds = Array.isArray(input.participantUserIds)
      ? (input.participantUserIds as string[]).map((v) => String(v).trim()).filter(Boolean)
      : [];
    const scheduledAtRaw = typeof input.scheduledAt === "string" ? input.scheduledAt.trim() : null;

    // ── (a) link an already-created ScheduledMeeting ──────────────────────
    if (scheduledMeetingId) {
      const linked = await linkScheduledMeetingToApplication({
        applicationId,
        scheduledMeetingId,
        actorUserId: callerId,
      });
      if (!linked) {
        throw new McpNotFoundError(
          `Partner application ${applicationId} or scheduled meeting ${scheduledMeetingId} not found`,
        );
      }
      return { id: linked.id, scheduledAt: linked.scheduledAt.toISOString(), scheduledMeetingId };
    }

    // ── (b) create a real ScheduledMeeting, then link it ──────────────────
    if (startTimeRaw) {
      if (participantUserIds.length === 0) {
        throw new McpInvalidError("participantUserIds is required alongside startTime");
      }
      const startTime = new Date(startTimeRaw);
      if (isNaN(startTime.getTime())) {
        throw new McpInvalidError(`Invalid startTime value: '${startTimeRaw}'`);
      }
      const app = await prisma.partnerApplication.findUnique({
        where: { id: applicationId },
        select: { applicantContact: { select: { name: true, email: true } } },
      });
      if (!app) throw new McpNotFoundError(`Partner application ${applicationId} not found`);

      const organizer = await prisma.user.findUnique({
        where: { id: callerId },
        select: { daliEmail: true, dartmouthEmail: true },
      });
      const organizerEmail = organizer?.daliEmail ?? organizer?.dartmouthEmail;
      if (!organizerEmail) {
        throw new McpInvalidError("Caller has no email on file to organize the meeting");
      }

      const guestEmails = Array.isArray(input.guestEmails)
        ? (input.guestEmails as string[]).map((v) => String(v).trim()).filter(Boolean)
        : app.applicantContact?.email
          ? [app.applicantContact.email]
          : undefined;

      const created = await createScheduledMeeting({
        organizerId: callerId,
        organizerEmail,
        title:
          typeof input.title === "string" && input.title.trim()
            ? input.title.trim()
            : `DALI x ${app.applicantContact?.name ?? "partner"}`,
        durationMinutes:
          typeof input.durationMinutes === "number" && input.durationMinutes > 0
            ? input.durationMinutes
            : 30,
        scope: { type: "UserList", participantUserIds },
        startTime: startTime.toISOString(),
        guestEmails,
        addMeet: true,
      });
      if (!created.ok) throw new McpInvalidError(created.error);

      const linked = await linkScheduledMeetingToApplication({
        applicationId,
        scheduledMeetingId: created.meeting.id,
        actorUserId: callerId,
      });
      return {
        id: linked?.id ?? created.meeting.id,
        scheduledAt: created.meeting.selectedAt?.toISOString() ?? startTime.toISOString(),
        scheduledMeetingId: created.meeting.id,
      };
    }

    // ── (c) legacy log-only row, no ScheduledMeeting ───────────────────────
    if (!scheduledAtRaw) {
      throw new McpInvalidError(
        "create requires one of: scheduledMeetingId, startTime+participantUserIds, or scheduledAt",
      );
    }
    const scheduledAt = new Date(scheduledAtRaw);
    if (isNaN(scheduledAt.getTime())) {
      throw new McpInvalidError(`Invalid scheduledAt value: '${scheduledAtRaw}'`);
    }

    const attendeeUserIds = Array.isArray(input.attendeeUserIds)
      ? (input.attendeeUserIds as string[]).map((v) => String(v).trim()).filter(Boolean)
      : [];
    const notes =
      typeof input.notes === "string" ? input.notes.trim() || null : null;

    // Verify the application exists and fetch the applicant contact (to store
    // the contactId FK on the meeting row — mirrors the web action behaviour).
    const app = await prisma.partnerApplication.findUnique({
      where: { id: applicationId },
      select: { applicantContactId: true },
    });
    if (!app) throw new McpNotFoundError(`Partner application ${applicationId} not found`);

    const meeting = await prisma.partnerMeeting.create({
      data: {
        applicationId,
        scheduledAt,
        attendeeUserIds,
        notes,
        contactId: app.applicantContactId ?? null,
      },
      select: { id: true },
    });

    await logPartnerActivity(prisma, {
      applicationId,
      actorUserId: callerId,
      type: "MeetingScheduled",
      metadata: { meetingId: meeting.id, scheduledAt: scheduledAt.toISOString() },
    });

    return { id: meeting.id, scheduledAt: scheduledAt.toISOString() };
  }

  // ── debrief ───────────────────────────────────────────────────────────────
  const applicationId = input.applicationId as string;
  const meetingId = (input.meetingId as string).trim();

  const debrief =
    typeof input.debrief === "string" ? input.debrief.trim() || null : null;
  const outcomeRaw =
    typeof input.outcome === "string" ? input.outcome.trim() : null;
  const outcome =
    outcomeRaw && (VALID_OUTCOMES as readonly string[]).includes(outcomeRaw)
      ? (outcomeRaw as MeetingOutcome)
      : null;

  if (debrief === null && outcome === null) {
    throw new McpInvalidError(
      "debrief requires at least one of: debrief (text) or outcome (Advance|Hold|Reject|MoreInfoNeeded)",
    );
  }

  try {
    await prisma.partnerMeeting.update({
      where: { id: meetingId },
      data: {
        ...(debrief !== null ? { debrief } : {}),
        ...(outcome !== null ? { outcome } : {}),
      },
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2025") {
      throw new McpNotFoundError(`Partner meeting ${meetingId} not found`);
    }
    throw e;
  }

  await logPartnerActivity(prisma, {
    applicationId,
    actorUserId: callerId,
    type: "MeetingDebriefed",
    metadata: { meetingId, ...(outcome ? { outcome } : {}) },
  });

  return { ok: true };
}
