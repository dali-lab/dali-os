// MCP tool: manage_partner_meeting — log and debrief partner meetings.
// Scope: mcp:write. Gated to isCore.
//
// Actions:
//   create  — create a PartnerMeeting row for an application (mirrors meeting-create intent).
//             Accepts scheduledAt (ISO string), optional attendeeUserIds, optional notes.
//             Does NOT email the partner — the web intent's notifyPartner option is intentionally
//             omitted here per the no-email rule. Use update_status or add_note for comms context.
//   debrief — set debrief text and/or outcome on an existing meeting (mirrors meeting-debrief intent).
//
// Web fns reused: logPartnerActivity (from partner-activity.server) for the
// MeetingScheduled / MeetingDebriefed activity rows. The PartnerMeeting create/update
// themselves are direct Prisma calls (same as the web action — no helper wrapping them).

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { logPartnerActivity } from "~/partners/lib/partner-activity.server";
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
    "Actions: create (applicationId+scheduledAt required; attendeeUserIds optional array of user ids; notes optional — does NOT email the partner), " +
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
      scheduledAt: {
        type: "string",
        description: "ISO 8601 datetime for the meeting (create). E.g. '2026-10-15T14:00:00Z'.",
      },
      attendeeUserIds: {
        type: "array",
        items: { type: "string" },
        description: "User ids of Core attendees (create, optional).",
      },
      notes: {
        type: "string",
        description: "Pre-meeting notes or agenda (create, optional).",
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
    create: ["applicationId", "scheduledAt"],
    debrief: ["applicationId", "meetingId"],
  });

  // ── create ────────────────────────────────────────────────────────────────
  if (action === "create") {
    const applicationId = input.applicationId as string;
    const scheduledAtRaw = (input.scheduledAt as string).trim();
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
