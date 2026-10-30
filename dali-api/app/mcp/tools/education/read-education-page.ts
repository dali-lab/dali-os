// MCP tool: read_education_page — read an offering material page's content.
// Reuses readMaterialPage from lms.server.ts.
// Access: any Approved enrollee or offering manager for this offering.
// Scope: mcp:read.

import { readMaterialPage } from "~/education/lib/lms.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { prisma } from "~/lib/db.server";
import { pageProps, pageText, TEXT_PAGE_LIMITS, type PageArgs } from "../../pagination";
import {
  McpForbiddenError,
  McpNotFoundError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const READ_EDUCATION_PAGE_TOOL = {
  name: "read_education_page",
  description:
    "Read the content of a material page in an education offering's workspace. Requires an Approved enrollment or offering-manager role. The content is a JSON string of the page's ProseMirror document, returned in chunks of limit characters: pass page.nextCursor as cursor until page.hasMore is false, then join the chunks in order and parse the result. page.total is the full length in characters.",
  inputSchema: {
    type: "object" as const,
    properties: {
      offeringId: { type: "string", minLength: 1 },
      pageId: { type: "string", minLength: 1 },
      ...pageProps(TEXT_PAGE_LIMITS),
    },
    required: ["offeringId", "pageId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Args = PageArgs & { offeringId: string; pageId: string };

export async function runReadEducationPage(ctx: McpCtx, args: Args) {
  // Gate: enrolled student or manager.
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

  const page = await readMaterialPage(args.offeringId, args.pageId);
  if (!page) throw new McpNotFoundError("Page not found");

  const chunk = pageText(JSON.stringify(page.content ?? null), args);

  return {
    id: page.id,
    title: page.title,
    content: chunk.text,
    page: chunk.page,
  };
}

export const READ_EDUCATION_PAGE: McpTool = {
  def: READ_EDUCATION_PAGE_TOOL,
  run: (ctx: McpCtx, args) => runReadEducationPage(ctx, args as Args),
};
