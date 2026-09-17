// MCP tool: read_education_discussion — read the discussion board for an offering.
// Reads both the announcement/message feed (announcements.server.ts listDiscussion)
// and the discussion threads (discussions.server.ts listThreads).
// Access: Approved enrollee or offering manager.
// Scope: mcp:read.

import { listDiscussion } from "~/education/lib/announcements.server";
import { listThreads, offeringInstructorIds } from "~/education/lib/discussions.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { prisma } from "~/lib/db";
import {
  McpForbiddenError,
  McpNotFoundError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const READ_EDUCATION_DISCUSSION_TOOL = {
  name: "read_education_discussion",
  description:
    "Read the discussion board for an education offering. Returns both the announcement/message feed and the discussion threads. Requires Approved enrollment or offering-manager role.",
  inputSchema: {
    type: "object" as const,
    properties: {
      offeringId: { type: "string", minLength: 1 },
    },
    required: ["offeringId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Args = { offeringId: string };

export async function runReadEducationDiscussion(ctx: McpCtx, args: Args) {
  const [manager, enrollment] = await Promise.all([
    isOfferingManager(ctx.user.id, args.offeringId),
    prisma.educationApplication.findFirst({
      where: {
        offeringId: args.offeringId,
        applicantUserId: ctx.user.id,
        status: "Approved",
      },
      select: { id: true },
    }),
  ]);

  if (!manager && !enrollment) {
    throw new McpForbiddenError("Enrollment or manager role required");
  }

  // Verify the offering exists.
  const offering = await prisma.educationOffering.findUnique({
    where: { id: args.offeringId },
    select: { id: true },
  });
  if (!offering) throw new McpNotFoundError("Offering not found");

  const instructorIds = await offeringInstructorIds(args.offeringId);

  const [announcements, threads] = await Promise.all([
    listDiscussion(args.offeringId),
    listThreads(args.offeringId, instructorIds),
  ]);

  return {
    // Serialize dates for MCP transport.
    announcements: announcements.map((a) => ({
      id: a.id,
      body: a.body,
      kind: a.kind,
      sentAt: a.sentAt.toISOString(),
      authorId: a.authorId,
      authorName: `${a.author.firstName} ${a.author.lastName}`.trim(),
      replies: a.replies.map((r) => ({
        id: r.id,
        body: r.body,
        sentAt: r.sentAt.toISOString(),
        authorId: r.authorId,
        authorName: `${r.author.firstName} ${r.author.lastName}`.trim(),
      })),
    })),
    threads: threads.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      replies: t.replies.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    })),
  };
}

export const READ_EDUCATION_DISCUSSION: McpTool = {
  def: READ_EDUCATION_DISCUSSION_TOOL,
  run: (ctx: McpCtx, args) => runReadEducationDiscussion(ctx, args as Args),
};
