// MCP `send_announcement` — fan-out announcement dispatcher for Core callers.
// Mirrors api.notifications.send.ts: when `sendAt` is in the future the row is
// persisted to ScheduledAnnouncement and the job fires it later; otherwise
// sendAnnouncement() is called immediately. Requires the `mcp:admin` scope.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { sendAnnouncement } from "~/lib/announcements.server";
import { AdminForbiddenError as McpForbiddenError, AdminInvalidError as McpInvalidError, AdminNotFoundError as McpNotFoundError } from "./errors";
import type { NotificationKind } from "~/generated/prisma/client";

export const SEND_ANNOUNCEMENT_TOOL = {
  name: "send_announcement",
  description:
    "Send (or schedule) a lab-wide announcement. Pick at least one audience source: allMembers, groupIds, or userIds. Supply sendAt (ISO datetime) to schedule for a future time instead of sending immediately. Requires Core.",
  inputSchema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        maxLength: 200,
        description: "Announcement title (required).",
      },
      body: {
        type: "string",
        maxLength: 2000,
        description: "Optional body text.",
      },
      link: {
        type: "string",
        maxLength: 500,
        description: "Optional URL the notification links to.",
      },
      kind: {
        type: "string",
        enum: ["General", "MeetingInvite", "MeetingReminder", "SystemAnnouncement"],
        description: "Notification kind (default General).",
      },
      isTodo: {
        type: "boolean",
        description: "If true, surfaces as a todo item in the recipient's task sidebar.",
      },
      dueAt: {
        type: "string",
        description: "ISO 8601 datetime deadline for the todo (only meaningful when isTodo=true).",
      },
      formId: {
        type: "string",
        description: "ID of a published form to attach.",
      },
      sendAt: {
        type: "string",
        description:
          "ISO 8601 datetime. When in the future the announcement is scheduled rather than sent immediately.",
      },
      allMembers: {
        type: "boolean",
        description: "Include all current lab members in the recipient set.",
      },
      groupIds: {
        type: "array",
        items: { type: "string" },
        description: "Lab group IDs whose members are included in the recipient set.",
      },
      userIds: {
        type: "array",
        items: { type: "string" },
        description: "Individual user IDs to include in the recipient set.",
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Input = {
  title: string;
  body?: string;
  link?: string;
  kind?: NotificationKind;
  isTodo?: boolean;
  dueAt?: string;
  formId?: string;
  sendAt?: string;
  allMembers?: boolean;
  groupIds?: string[];
  userIds?: string[];
};

export async function runSendAnnouncement(callerId: string, input: Input) {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core leads can send announcements.");
  }

  const groupIds = input.groupIds ?? [];
  const userIds = input.userIds ?? [];
  const allMembers = input.allMembers ?? false;
  const dueAt = input.dueAt ? new Date(input.dueAt) : null;

  // Schedule path: sendAt in the future.
  const sendAt = input.sendAt ? new Date(input.sendAt) : null;
  if (sendAt && sendAt.getTime() > Date.now()) {
    if (!allMembers && groupIds.length === 0 && userIds.length === 0) {
      throw new McpInvalidError("Pick an audience.");
    }
    // Validate form at compose time (job re-validates at fire time too).
    if (input.formId) {
      const form = await prisma.form.findUnique({
        where: { id: input.formId },
        select: { published: true },
      });
      if (!form) throw new McpNotFoundError("Attached form not found.");
      if (!form.published) {
        throw new McpInvalidError("Attach a published form (publish it first).");
      }
    }
    const scheduled = await prisma.scheduledAnnouncement.create({
      data: {
        createdByUserId: callerId,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        kind: input.kind ?? "General",
        isTodo: input.isTodo ?? false,
        dueAt,
        formId: input.formId ?? null,
        allMembers,
        groupIds,
        userIds,
        sendAt,
      },
      select: { id: true, sendAt: true },
    });
    return { ok: true, scheduled: true, id: scheduled.id };
  }

  // Immediate send path.
  const result = await sendAnnouncement({
    createdByUserId: callerId,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    kind: input.kind ?? null,
    isTodo: input.isTodo ?? null,
    dueAt,
    formId: input.formId ?? null,
    allMembers,
    groupIds,
    userIds,
  });

  if (!result.ok) {
    // Map sendAnnouncement's error+status back to the MCP error hierarchy.
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }

  return { ok: true, count: result.count };
}
