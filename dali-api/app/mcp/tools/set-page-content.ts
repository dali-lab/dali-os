// MCP `set_page_content` — replaces a FreeForm page's body with content
// rendered from Markdown. The write goes through the collab pipeline
// (~/collab/write.ts): markdown → BlockNote blocks → Yjs "blocknote"
// fragment, applied via a Hocuspocus direct connection so open editors sync
// live and a version snapshot is kept (the previous body stays restorable
// from Version history). Gate mirrors the web's getPageAccess canEdit check
// — works for Project, Lab, and personal-note (Member) workspace pages.

import { prisma } from "~/lib/db.server";
import { PAGE_ACCESS_SELECT, getPageAccess } from "~/lib/pageAccess.server";
import { parseMarkdown } from "../doc-markdown.server";
import { replaceCollabDocContent } from "~/collab/write";
import { announceAgent, pagePresenceRoom } from "~/collab/agent-presence.server";
import { pageDocName } from "~/collab/roomName";

// Generous but bounded — a huge page body is ~100 KB of markdown.
export const MAX_MARKDOWN_LENGTH = 300_000;

export const SET_PAGE_CONTENT_TOOL = {
  name: "set_page_content",
  description:
    "Replace a page's body with content rendered from Markdown (headings, lists, quotes, code blocks, links, bold/italic/strike, and images via ![alt](src) — use upload_project_file with purpose 'pageImage' to get a src). ![title](youtube url) adds a video player. Works for Project, Lab, and personal-note (Member) workspace pages. OVERWRITES the existing body. To change part of an existing page, use edit_content instead (when available); otherwise read_page first to preserve content. Mention a member as [@handle](/members/<userId>) (not @Name), a page as [Title](/documents/<pageId>) and a task as [Title](/projects/<projectId>?tab=progress&task=<taskId>); an id that is unknown (or not a lab member, or a task outside the named project) is written as plain text and listed in warnings. The old body remains restorable from the page's version history. Requires edit access on the page (Core, staffed on the project, or page owner).",
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

export async function loadEditablePage(callerId: string, pageId: string) {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      ...PAGE_ACCESS_SELECT,
      kind: true,
      contentDocId: true,
    },
  });
  if (!page) throw new SetPageContentError("Page not found", 404);
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
    throw new SetPageContentError("Page is archived. Restore it first with manage_page update.", 400);
  }
  const access = await getPageAccess(callerId, page);
  if (!access.canEdit) throw new SetPageContentError("Forbidden", 403);
  return page;
}

export async function runSetPageContent(callerId: string, input: Input) {
  const page = await loadEditablePage(callerId, input.pageId);
  const { blocks, warnings } = await parseMarkdown(input.markdown);

  void announceAgent({ action: "editing", presenceRoom: pagePresenceRoom(page.id) });
  await replaceCollabDocContent(page.contentDocId ?? pageDocName(page.id), blocks, callerId);

  await prisma.page.update({
    where: { id: page.id },
    data: { lastEditedById: callerId },
  });

  return { id: page.id, blockCount: blocks.length, ...(warnings.length ? { warnings } : {}) };
}
