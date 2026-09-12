// MCP `set_page_content` — replaces a FreeForm page's body with content
// rendered from Markdown. The write goes through the collab pipeline
// (~/collab/write.ts): markdown → BlockNote blocks → Yjs "blocknote"
// fragment, applied via a Hocuspocus direct connection so open editors sync
// live and a version snapshot is kept (the previous body stays restorable
// from Version history). Gate mirrors the web's getPageAccess canEdit check
// — works for Project, Lab, and personal-note (Member) workspace pages.

import { prisma } from "~/lib/db";
import { getPageAccess } from "~/lib/pageAccess.server";
import { markdownToBlocks } from "~/collab/blocknote-server";
import { replaceCollabDocContent } from "~/collab/write";
import { pageDocName } from "~/collab/roomName";

// Generous but bounded — a huge page body is ~100 KB of markdown.
const MAX_MARKDOWN_LENGTH = 300_000;

export const SET_PAGE_CONTENT_TOOL = {
  name: "set_page_content",
  description:
    "Replace a page's body with content rendered from Markdown (headings, lists, quotes, code blocks, links, bold/italic/strike, and images via ![alt](src) — use upload_project_file with purpose 'pageImage' to get a src). Works for Project, Lab, and personal-note (Member) workspace pages. OVERWRITES the existing body; read_page first to preserve content. The old body remains restorable from the page's version history. Requires edit access on the page (Core, staffed on the project, or page owner).",
  inputSchema: {
    type: "object" as const,
    properties: {
      pageId: { type: "string", minLength: 1 },
      markdown: {
        type: "string",
        maxLength: MAX_MARKDOWN_LENGTH,
        description: "New page body as Markdown. Empty string clears the page.",
      },
    },
    required: ["pageId", "markdown"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { pageId: string; markdown: string };

export class SetPageContentError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "SetPageContentError";
  }
}

export async function runSetPageContent(callerId: string, input: Input) {
  const page = await prisma.page.findUnique({
    where: { id: input.pageId },
    select: {
      id: true,
      kind: true,
      workspaceType: true,
      workspaceId: true,
      contentDocId: true,
      archivedAt: true,
    },
  });
  if (!page) throw new SetPageContentError("Page not found", 404);

  // Only the workspace types that carry a FreeForm body are valid targets.
  if (
    page.workspaceType !== "Project" &&
    page.workspaceType !== "Lab" &&
    page.workspaceType !== "Member"
  ) {
    throw new SetPageContentError("Page workspace type does not support content editing", 400);
  }

  if (page.kind !== "FreeForm") {
    throw new SetPageContentError(`${page.kind} pages have no editable body`, 400);
  }
  if (page.archivedAt) {
    throw new SetPageContentError("Page is archived — unarchive it first (update_page)", 400);
  }

  // Use getPageAccess — the same gate as the web — so Project/Lab/Member
  // pages all get the correct permission check without reimplementing it.
  const access = await getPageAccess(callerId, {
    id: page.id,
    workspaceType: page.workspaceType,
    workspaceId: page.workspaceId,
    archivedAt: page.archivedAt,
  });
  if (!access.canEdit) {
    throw new SetPageContentError("Forbidden", 403);
  }

  let blocks;
  try {
    blocks = await markdownToBlocks(input.markdown);
  } catch {
    throw new SetPageContentError("Markdown could not be parsed", 400);
  }

  // Same doc-name derivation as read_page so the two tools round-trip.
  await replaceCollabDocContent(page.contentDocId ?? pageDocName(page.id), blocks, callerId);

  await prisma.page.update({
    where: { id: page.id },
    data: { lastEditedById: callerId },
  });

  return { id: page.id, blockCount: blocks.length };
}
