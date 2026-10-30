// MCP tool: read_education_discussion — read the discussion board for an offering.
// Reads both the announcement/message feed (announcements.server.ts listDiscussion)
// and the discussion threads (discussions.server.ts listThreads).
// Access: Approved enrollee or offering manager.
// Scope: mcp:read.

import { listDiscussion } from "~/education/lib/announcements.server";
import { listThreadPage, offeringInstructorIds } from "~/education/lib/discussions.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { prisma } from "~/lib/db";
import {
  McpForbiddenError,
  McpInvalidError,
  McpNotFoundError,
  type McpCtx,
  type McpTool,
} from "../../registry";
import { keysetPage, keysetWindow, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const READ_EDUCATION_DISCUSSION_TOOL = {
  name: "read_education_discussion",
  description:
    "Read the discussion board for an education offering, newest first. Without feed, returns the first page of both the announcement/message feed (announcementsPage) and the discussion threads (threadsPage). Pass feed to read one of them and page through it with page.nextCursor as cursor until page.hasMore is false. Announcement replies show the oldest 200 per post: compare replyTotal with replies.length. Requires Approved enrollment or offering-manager role.",
  inputSchema: {
    type: "object" as const,
    properties: {
      offeringId: { type: "string", minLength: 1 },
      feed: {
        type: "string",
        enum: ["announcements", "threads"],
        description: "Read just this feed, one page per call. Required to use cursor.",
      },
      ...pageProps(PAGE_LIMITS),
    },
    required: ["offeringId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Feed = "announcements" | "threads";
type Args = PageArgs & { offeringId: string; feed?: Feed };

async function readAnnouncements(offeringId: string, args: PageArgs) {
  const window = keysetWindow(args, PAGE_LIMITS, [
    { field: "sentAt", direction: "desc", type: "date" },
  ]);
  const [fetched, total] = await Promise.all([
    listDiscussion(offeringId, { and: window.where, take: window.take }),
    prisma.educationAnnouncement.count({ where: { offeringId, parentId: null } }),
  ]);
  const { rows, page } = keysetPage(fetched, window, total);
  return {
    page,
    announcements: rows.map((a) => ({
      id: a.id,
      body: a.body,
      kind: a.kind,
      sentAt: a.sentAt.toISOString(),
      authorId: a.authorId,
      authorName: `${a.author.firstName} ${a.author.lastName}`.trim(),
      replyTotal: a._count.replies,
      replies: a.replies.map((r) => ({
        id: r.id,
        body: r.body,
        sentAt: r.sentAt.toISOString(),
        authorId: r.authorId,
        authorName: `${r.author.firstName} ${r.author.lastName}`.trim(),
      })),
    })),
  };
}

async function readThreads(offeringId: string, instructorIds: Set<string>, args: PageArgs) {
  const window = keysetWindow(args, PAGE_LIMITS, [
    { field: "createdAt", direction: "desc", type: "date" },
  ]);
  const [fetched, total] = await Promise.all([
    listThreadPage(offeringId, instructorIds, { and: window.where, take: window.take }),
    prisma.educationDiscussionPost.count({ where: { offeringId, parentId: null } }),
  ]);
  const { rows, page } = keysetPage(fetched, window, total);
  return {
    page,
    threads: rows.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      replies: t.replies.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    })),
  };
}

export async function runReadEducationDiscussion(ctx: McpCtx, args: Args) {
  if (args.cursor && !args.feed) {
    throw new McpInvalidError("cursor needs a feed: pass feed \"announcements\" or \"threads\".");
  }
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

  if (args.feed === "announcements") {
    return { feed: args.feed, ...(await readAnnouncements(args.offeringId, args)) };
  }

  const instructorIds = await offeringInstructorIds(args.offeringId);
  if (args.feed === "threads") {
    return { feed: args.feed, ...(await readThreads(args.offeringId, instructorIds, args)) };
  }

  const [announcements, threads] = await Promise.all([
    readAnnouncements(args.offeringId, { limit: args.limit }),
    readThreads(args.offeringId, instructorIds, { limit: args.limit }),
  ]);
  return {
    announcements: announcements.announcements,
    announcementsPage: announcements.page,
    threads: threads.threads,
    threadsPage: threads.page,
  };
}

export const READ_EDUCATION_DISCUSSION: McpTool = {
  def: READ_EDUCATION_DISCUSSION_TOOL,
  run: (ctx: McpCtx, args) => runReadEducationDiscussion(ctx, args as Args),
};
