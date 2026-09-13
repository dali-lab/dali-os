// MCP `manage_email_sender` — disable or set rate cap on a Gmail sender integration.
// Reuses admin.email-senders.tsx actions. Requires mcp:admin (Core leads only).

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminNotFoundError as McpNotFoundError,
  AdminInvalidError as McpInvalidError,
} from "./errors";
import type { McpCtx } from "../../registry";

export const MANAGE_EMAIL_SENDER_TOOL = {
  name: "manage_email_sender",
  description:
    "Disable a Gmail sender integration or set/clear its daily email cap. " +
    "action=disable: soft-disables the send-as identity. " +
    "action=save_cap: sets (or clears) the daily email cap for this sender. " +
    "Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["disable", "save_cap"],
        description: "disable — soft-disable the sender; save_cap — set/clear daily cap.",
      },
      integrationId: {
        type: "string",
        description: "GmailIntegration id (from list_email_senders).",
      },
      dailyCap: {
        type: "number",
        description: "save_cap: positive integer sets the cap; 0 or omit to clear (uncapped).",
      },
    },
    required: ["action", "integrationId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = {
  action: string;
  integrationId: string;
  dailyCap?: number;
};

export async function runManageEmailSender(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can manage email senders.");
  }

  const { action, integrationId } = args;

  // Verify the integration exists
  const row = await prisma.gmailIntegration.findUnique({
    where: { id: integrationId },
    select: { id: true },
  });
  if (!row) throw new McpNotFoundError("Gmail integration not found.");

  if (action === "disable") {
    await prisma.gmailIntegration.update({
      where: { id: integrationId },
      data: { enabled: false },
    });
    return { ok: true };
  }

  if (action === "save_cap") {
    const cap =
      args.dailyCap !== undefined && args.dailyCap > 0 ? Math.floor(args.dailyCap) : null;
    await prisma.gmailIntegration.update({
      where: { id: integrationId },
      data: { dailyCap: cap },
    });
    return { ok: true, dailyCap: cap };
  }

  throw new McpInvalidError(`Unknown action: ${action}`);
}
