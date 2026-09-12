// MCP `list_outbound_messages` — transactional outbox viewer.
// Reuses admin.outbound-messages.tsx loader query. mcp:admin, Core leads only.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import type { McpCtx } from "../../registry";

export const LIST_OUTBOUND_MESSAGES_TOOL = {
  name: "list_outbound_messages",
  description:
    "List recent outbound messages from the transactional outbox (up to 100 rows, newest-first). " +
    "Optionally filter by status or search recipient/subject/event. Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      status: {
        type: "string",
        enum: ["Pending", "Sending", "Sent", "Dead", "Canceled"],
        description: "Filter by message status.",
      },
      q: {
        type: "string",
        description: "Text search across target, recipientUserId, eventType, subject.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = { status?: string; q?: string };

export async function runListOutboundMessages(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can view outbound messages.");
  }

  const { status, q } = args;
  const qTrim = q?.trim() ?? "";

  const rows = await prisma.outboundMessage.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(qTrim
        ? {
            OR: [
              { target: { contains: qTrim, mode: "insensitive" } },
              { recipientUserId: { contains: qTrim, mode: "insensitive" } },
              { eventType: { contains: qTrim, mode: "insensitive" } },
              { subject: { contains: qTrim, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      channel: true,
      status: true,
      target: true,
      recipientUserId: true,
      subject: true,
      eventType: true,
      attempts: true,
      lastError: true,
      sentAt: true,
      createdAt: true,
    },
  });

  return {
    messages: rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      status: r.status,
      target: r.target,
      recipientUserId: r.recipientUserId,
      subject: r.subject,
      eventType: r.eventType,
      attempts: r.attempts,
      lastError: r.lastError,
      sentAt: r.sentAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    total: rows.length,
  };
}
