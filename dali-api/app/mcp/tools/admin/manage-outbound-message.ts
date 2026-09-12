// MCP `manage_outbound_message` — retry a Dead message or cancel a Pending one.
// Reuses admin.outbound-messages.tsx action logic. mcp:admin, Core leads only.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminNotFoundError as McpNotFoundError,
  AdminInvalidError as McpInvalidError,
} from "./errors";
import type { McpCtx } from "../../registry";

export const MANAGE_OUTBOUND_MESSAGE_TOOL = {
  name: "manage_outbound_message",
  description:
    "Retry a Dead outbound message (resets it to Pending for re-delivery) or cancel a Pending one. Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["retry", "cancel"],
        description:
          "retry — reset a Dead message to Pending; cancel — stop a Pending message from sending.",
      },
      messageId: {
        type: "string",
        description: "OutboundMessage id.",
      },
    },
    required: ["action", "messageId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = { action: string; messageId: string };

export async function runManageOutboundMessage(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can manage outbound messages.");
  }

  const { action, messageId } = args;

  if (action === "retry") {
    const result = await prisma.outboundMessage.updateMany({
      where: { id: messageId, status: "Dead" },
      data: { status: "Pending", nextAttemptAt: new Date(), attempts: 0, lastError: null },
    });
    if (result.count === 0) throw new McpNotFoundError("Dead outbound message not found.");
    return { ok: true };
  }

  if (action === "cancel") {
    const result = await prisma.outboundMessage.updateMany({
      where: { id: messageId, status: "Pending" },
      data: { status: "Canceled" },
    });
    if (result.count === 0) throw new McpNotFoundError("Pending outbound message not found.");
    return { ok: true };
  }

  throw new McpInvalidError(`Unknown action: ${action}`);
}
