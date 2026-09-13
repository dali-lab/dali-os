// MCP `manage_activity` — list/create/update/publish/archive/delete activities.
// Reuses ~/lib/activities.server.ts server functions. mcp:admin, Core leads only.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  listActivitiesForAdmin,
  createActivity,
  updateActivity,
  setActivityStatus,
  deleteActivity,
} from "~/lib/activities.server";
import { isActivityKind } from "~/lib/activities";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminNotFoundError as McpNotFoundError,
  AdminInvalidError as McpInvalidError,
} from "./errors";
import type { McpCtx } from "../../registry";
import type { ActivityStatus } from "~/generated/prisma/client";

export const MANAGE_ACTIVITY_TOOL = {
  name: "manage_activity",
  description:
    "Manage time-boxed Activities (onboarding hunts and site modes). " +
    "action=list: list all activities. " +
    "action=create: create a new Draft activity (name + kind required). " +
    "action=update: update name/window/audience/termId. " +
    "action=set_status: transition status to Published/Draft/Archived. " +
    "action=delete: delete a Draft activity with no events. " +
    "Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["list", "create", "update", "set_status", "delete"],
        description: "Operation to perform.",
      },
      activityId: {
        type: "string",
        description: "Activity id (required for update/set_status/delete).",
      },
      name: {
        type: "string",
        description: "Activity name (required for create; optional for update).",
      },
      kind: {
        type: "string",
        enum: ["scavenger_hunt"],
        description: "Activity mechanic (required for create).",
      },
      termId: {
        type: "string",
        description: "Term id to associate (optional).",
      },
      startsAt: {
        type: "string",
        description: "ISO 8601 datetime for window start.",
      },
      endsAt: {
        type: "string",
        description: "ISO 8601 datetime for window end.",
      },
      audienceEveryone: {
        type: "boolean",
        description: "update: whether audience is all lab members.",
      },
      status: {
        type: "string",
        enum: ["Draft", "Published", "Archived"],
        description: "set_status: target status.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = {
  action: string;
  activityId?: string;
  name?: string;
  kind?: string;
  termId?: string;
  startsAt?: string;
  endsAt?: string;
  audienceEveryone?: boolean;
  status?: string;
};

export async function runManageActivity(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can manage activities.");
  }

  const { action } = args;

  if (action === "list") {
    const activities = await listActivitiesForAdmin();
    return {
      activities: activities.map((a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        status: a.status,
        termId: a.termId,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        participantCount: a.participantCount,
        eventCount: a.eventCount,
      })),
    };
  }

  if (action === "create") {
    if (!args.name?.trim()) throw new McpInvalidError("name is required for create.");
    if (!args.kind || !isActivityKind(args.kind)) {
      throw new McpInvalidError("Valid kind is required for create (e.g. scavenger_hunt).");
    }
    const now = new Date();
    const activity = await createActivity(
      {
        kind: args.kind,
        name: args.name.trim(),
        termId: args.termId ?? null,
        startsAt: args.startsAt ? new Date(args.startsAt) : now,
        endsAt: args.endsAt
          ? new Date(args.endsAt)
          : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
      ctx.user.id,
    );
    await logAuditEvent({
      action: "activities.create",
      userId: ctx.user.id,
      targetId: activity.id,
      metadata: { kind: args.kind, name: args.name.trim() },
      request: ctx.request,
    });
    return { ok: true, id: activity.id };
  }

  if (action === "update") {
    if (!args.activityId) throw new McpInvalidError("activityId is required for update.");
    const existing = await prisma.activity.findUnique({
      where: { id: args.activityId },
      select: { id: true },
    });
    if (!existing) throw new McpNotFoundError("Activity not found.");
    await updateActivity(args.activityId, {
      ...(args.name ? { name: args.name.trim() } : {}),
      ...(args.termId !== undefined ? { termId: args.termId || null } : {}),
      ...(args.startsAt ? { startsAt: new Date(args.startsAt) } : {}),
      ...(args.endsAt ? { endsAt: new Date(args.endsAt) } : {}),
      ...(args.audienceEveryone !== undefined
        ? { audienceEveryone: args.audienceEveryone }
        : {}),
    });
    await logAuditEvent({
      action: "activities.update",
      userId: ctx.user.id,
      targetId: args.activityId,
      request: ctx.request,
    });
    return { ok: true };
  }

  if (action === "set_status") {
    if (!args.activityId) throw new McpInvalidError("activityId is required for set_status.");
    if (!args.status || !["Draft", "Published", "Archived"].includes(args.status)) {
      throw new McpInvalidError("status must be Draft, Published, or Archived.");
    }
    const existing = await prisma.activity.findUnique({
      where: { id: args.activityId },
      select: { id: true },
    });
    if (!existing) throw new McpNotFoundError("Activity not found.");
    await setActivityStatus(args.activityId, args.status as ActivityStatus);
    await logAuditEvent({
      action: "activities.status",
      userId: ctx.user.id,
      targetId: args.activityId,
      metadata: { status: args.status },
      request: ctx.request,
    });
    return { ok: true };
  }

  if (action === "delete") {
    if (!args.activityId) throw new McpInvalidError("activityId is required for delete.");
    const eventCount = await prisma.activityEvent.count({
      where: { activityId: args.activityId },
    });
    if (eventCount > 0)
      throw new McpInvalidError(
        "This activity has participation events — archive it instead of deleting.",
      );
    const existing = await prisma.activity.findUnique({
      where: { id: args.activityId },
      select: { id: true, status: true },
    });
    if (!existing) throw new McpNotFoundError("Activity not found.");
    if (existing.status !== "Draft")
      throw new McpInvalidError("Only Draft activities can be deleted — archive it first.");
    await deleteActivity(args.activityId);
    await logAuditEvent({
      action: "activities.delete",
      userId: ctx.user.id,
      targetId: args.activityId,
      request: ctx.request,
    });
    return { ok: true };
  }

  throw new McpInvalidError(`Unknown action: ${action}`);
}
