// MCP tool: post_education_announcement — post an announcement or message in an
// offering's discussion, or reply to an existing post.
// Reuses postAnnouncement from announcements.server.ts (same fn the manage route
// calls via the "post-announcement" intent, and the hub route's runDiscussionAction).
//
// The lib function self-gates:
//   - Manager posts default to kind=Announcement (fans out to all enrollees).
//   - Student posts are always kind=Message (quiet, doesn't fan out).
//   - Replies never fan out regardless of role.
//
// COLLAB-BODY NOTE: body is plain text only — the announcement post is stored
// in the EducationAnnouncement table, NOT a collab doc. No collab pipeline.
//
// Gate: canPostInDiscussion (Approved enrollee or offering manager).
// Scope: mcp:write.

import { postAnnouncement } from "~/education/lib/announcements.server";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const POST_EDUCATION_ANNOUNCEMENT_TOOL = {
  name: "post_education_announcement",
  description:
    "Post a message or announcement in an offering's discussion board, or reply to an existing post. Managers post Announcements by default (fans out to all enrollees via in-app + email); pass kind='Message' for a quiet post. Students can only post Messages. Replies never fan out.",
  inputSchema: {
    type: "object" as const,
    properties: {
      offeringId: { type: "string", minLength: 1 },
      body: { type: "string", minLength: 1 },
      kind: {
        type: "string",
        enum: ["Announcement", "Message"],
        description:
          "Managers: 'Announcement' (default, fans out) or 'Message' (quiet). Students: always 'Message'.",
      },
      parentId: {
        type: "string",
        description: "Set to reply to a top-level post. Only one reply level is allowed.",
      },
    },
    required: ["offeringId", "body"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Args = {
  offeringId: string;
  body: string;
  kind?: "Announcement" | "Message";
  parentId?: string;
};

export async function runPostEducationAnnouncement(ctx: McpCtx, args: Args) {
  const result = await postAnnouncement({
    offeringId: args.offeringId,
    authorId: ctx.user.id,
    body: args.body,
    kind: args.kind ?? "Announcement",
    parentId: args.parentId ?? null,
  });

  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    if (result.status === 403) throw new McpForbiddenError(result.error);
    throw new McpInvalidError(result.error);
  }

  return { ok: true };
}

export const POST_EDUCATION_ANNOUNCEMENT: McpTool = {
  def: POST_EDUCATION_ANNOUNCEMENT_TOOL,
  run: (ctx: McpCtx, args) => runPostEducationAnnouncement(ctx, args as Args),
};
