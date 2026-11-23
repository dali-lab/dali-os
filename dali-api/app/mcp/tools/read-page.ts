import { prisma } from "~/lib/db.server";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToMarkdown } from "~/collab/blocknote-server";
import { pageDocName } from "~/collab/roomName";
import { authorizeCollabDoc } from "~/lib/collabAuth.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { announceAgent, pagePresenceRoom } from "~/collab/agent-presence.server";
import { TEXT_PAGE_LIMITS, pageProps, pageText, type PageArgs } from "../pagination";

export const READ_PAGE_TOOL = {
  name: "read_page",
  description:
    "Read a workspace page's content as Markdown (headings, lists, check lists, quotes, code, tables, images). Lossy for editor-only blocks (callouts/toggles flatten). Member mentions read as [@handle](/members/<userId>), page mentions as [Title](/documents/<pageId>) and task mentions as [Title](/projects/<projectId>?tab=progress&task=<taskId>); all three round-trip through edit_content. To change part of a page, use outline_content and edit_content rather than rewriting it; edit_content replace_all swaps the whole body. For a personal note, also returns its tags, public flag, lab listing, share count and whether you own it. Long pages come back in chunks of limit characters (default 50000, max 200000): pass page.nextCursor as cursor until page.hasMore is false. page.total is the full Markdown length.",
  inputSchema: {
    type: "object" as const,
    properties: {
      pageId: { type: "string", minLength: 1 },
      ...pageProps(TEXT_PAGE_LIMITS),
    },
    required: ["pageId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = PageArgs & { pageId: string };

export class ReadPageError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ReadPageError";
  }
}

export async function runReadPage(callerId: string, input: Input) {
  const page = await prisma.page.findUnique({
    where: { id: input.pageId },
    select: {
      id: true,
      title: true,
      kind: true,
      workspaceType: true,
      workspaceId: true,
      contentDocId: true,
      iconEmoji: true,
      parentPageId: true,
      profileVisible: true,
      labListing: true,
      createdAt: true,
      updatedAt: true,
      tags: { select: { tag: { select: { id: true, label: true, color: true } } } },
      _count: { select: { shares: true } },
    },
  });
  if (!page) throw new ReadPageError("Page not found", 404);

  if (!(await authorizeCollabDoc(callerId, pageDocName(page.id))).allowed) {
    throw new ReadPageError("Forbidden", 403);
  }

  const blocks = await readDocAsBlocks(page.contentDocId ?? pageDocName(page.id));
  const fullMarkdown = blocks.length ? await blocksToMarkdown(blocks, { inlineRefs: true }) : "";
  const { text: markdown, page: pageInfo } = pageText(fullMarkdown, input);
  void announceAgent({ action: "reading", presenceRoom: pagePresenceRoom(page.id) });

  const note =
    page.workspaceType === "Member"
      ? {
          parentPageId: page.parentPageId,
          visibility: page.profileVisible ? "public" : "private",
          labListing: page.labListing,
          createdAt: page.createdAt.toISOString(),
          updatedAt: page.updatedAt.toISOString(),
          tags: page.tags.map((t) => t.tag),
          shareCount: page._count.shares,
          isOwner: page.workspaceId === callerId,
          canEdit: (await getPageAccess(callerId, page.id)).canEdit,
        }
      : undefined;

  return {
    id: page.id,
    title: page.title,
    kind: page.kind,
    workspaceType: page.workspaceType,
    workspaceId: page.workspaceId,
    iconEmoji: page.iconEmoji,
    markdown,
    page: pageInfo,
    ...(note ? { note } : {}),
  };
}
