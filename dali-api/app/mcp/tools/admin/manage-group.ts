// MCP `manage_group` — create, update, or delete a Static lab group.
// Requires the `mcp:admin` scope; caller must be an admin.

import { prisma } from "~/lib/db";
import { isAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminNotFoundError as McpNotFoundError,
  AdminInvalidError as McpInvalidError,
  requireForAction,
} from "./errors";
import type { McpCtx } from "../../registry";

export const MANAGE_GROUP_TOOL = {
  name: "manage_group",
  description:
    "Create, update, or delete a Static lab group. Only admins may call this tool. " +
    "System-managed groups (systemKey set) cannot be edited or deleted. " +
    "Dynamic groups cannot have their member list overridden — those update automatically.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "delete"],
        description: "The operation to perform.",
      },
      groupId: {
        type: "string",
        description: "Required for update and delete — the id of the group to modify.",
      },
      name: {
        type: "string",
        description: "Display name of the group (1–100 chars). Required for create; optional for update.",
      },
      staticMemberIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Full replacement list of member userIds. Required for create (min 1); optional for update (Static groups only).",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Input = {
  action: string;
  groupId?: string;
  name?: string;
  staticMemberIds?: string[];
};

export async function runManageGroup(ctx: McpCtx, args: Input) {
  const callerId = ctx.user.id;
  const { request } = ctx;

  if (!(await isAdmin(callerId))) {
    throw new McpForbiddenError("Only admins can manage groups.");
  }

  requireForAction(args.action, args as Record<string, unknown>, {
    create: ["name", "staticMemberIds"],
    update: ["groupId"],
    delete: ["groupId"],
  });

  if (args.action === "create") {
    const { name, staticMemberIds } = args as Required<Pick<Input, "name" | "staticMemberIds">>;

    if (name.length < 1 || name.length > 100) {
      throw new McpInvalidError("name must be between 1 and 100 characters.");
    }
    if (staticMemberIds.length < 1) {
      throw new McpInvalidError("staticMemberIds must contain at least one member.");
    }

    const group = await prisma.groupDefinition.create({
      data: { name, type: "Static", staticMemberIds },
    });

    await logAuditEvent({
      action: "group.create",
      userId: callerId,
      targetId: group.id,
      metadata: { name, memberCount: staticMemberIds.length },
      request,
    });

    return group;
  }

  if (args.action === "update") {
    const { groupId, name, staticMemberIds } = args as Input & { groupId: string };

    const existing = await prisma.groupDefinition.findUnique({
      where: { id: groupId },
      select: { type: true, systemKey: true },
    });
    if (!existing) throw new McpNotFoundError(`Group '${groupId}' not found.`);
    if (existing.systemKey) {
      throw new McpInvalidError("System-managed groups cannot be edited.");
    }
    if (existing.type !== "Static" && staticMemberIds !== undefined) {
      throw new McpInvalidError("Dynamic groups update automatically — their member list cannot be overridden.");
    }
    if (name !== undefined && (name.length < 1 || name.length > 100)) {
      throw new McpInvalidError("name must be between 1 and 100 characters.");
    }

    const updated = await prisma.groupDefinition.update({
      where: { id: groupId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(staticMemberIds !== undefined ? { staticMemberIds } : {}),
      },
    });

    await logAuditEvent({
      action: "group.update",
      userId: callerId,
      targetId: groupId,
      metadata: {
        ...(name !== undefined ? { name } : {}),
        ...(staticMemberIds !== undefined ? { memberCount: staticMemberIds.length } : {}),
      },
      request,
    });

    return updated;
  }

  // action === "delete"
  const { groupId } = args as Input & { groupId: string };

  const existing = await prisma.groupDefinition.findUnique({
    where: { id: groupId },
    select: { systemKey: true },
  });
  if (!existing) throw new McpNotFoundError(`Group '${groupId}' not found.`);
  if (existing.systemKey) {
    throw new McpInvalidError("System-managed groups cannot be deleted.");
  }

  await prisma.groupDefinition.delete({ where: { id: groupId } });

  await logAuditEvent({
    action: "group.delete",
    userId: callerId,
    targetId: groupId,
    request,
  });

  return { ok: true };
}
