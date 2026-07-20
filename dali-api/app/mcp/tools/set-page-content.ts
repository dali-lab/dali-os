// MCP `set_page_content` — replaces a FreeForm page's body with content
// rendered from Markdown. The write goes through the collab pipeline
// (~/collab/write.ts): markdown → ProseMirror JSON → Yjs, applied via a
// Hocuspocus direct connection so open editors sync live and a version
// snapshot is kept (the previous body stays restorable from Version history).
// Core-only, matching create_page.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { markdownToProseMirror } from "~/collab/import-markdown";
import { replaceCollabDocContent } from "~/collab/write";
import { pageDocName } from "~/collab/roomName";

// Generous but bounded — a huge page body is ~100 KB of markdown.
const MAX_MARKDOWN_LENGTH = 300_000;

export const SET_PAGE_CONTENT_TOOL = {
  name: "set_page_content",
  description:
    "Replace a project page's body with content rendered from Markdown (headings, lists, quotes, code blocks, links, bold/italic/strike, and images via ![alt](src) — use upload_project_file with purpose 'pageImage' to get a src). OVERWRITES the existing body; read_page first to preserve content. The old body remains restorable from the page's version history. Core-only.",
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
  if (!(await isCore(callerId))) {
    throw new SetPageContentError("Forbidden", 403);
  }

  const page = await prisma.page.findUnique({
    where: { id: input.pageId },
    select: {
      id: true,
      kind: true,
      workspaceType: true,
      contentDocId: true,
      archivedAt: true,
    },
  });
  if (!page) throw new SetPageContentError("Page not found", 404);
  if (page.workspaceType !== "Project") {
    throw new SetPageContentError("Only project workspace pages can be written via MCP", 400);
  }
  if (page.kind !== "FreeForm") {
    throw new SetPageContentError(`${page.kind} pages have no editable body`, 400);
  }
  if (page.archivedAt) {
    throw new SetPageContentError("Page is archived — unarchive it first (update_page)", 400);
  }

  let doc;
  try {
    doc = markdownToProseMirror(input.markdown);
  } catch {
    throw new SetPageContentError("Markdown could not be parsed", 400);
  }

  // Same doc-name derivation as read_page so the two tools round-trip.
  await replaceCollabDocContent(page.contentDocId ?? pageDocName(page.id), doc, callerId);

  await prisma.page.update({
    where: { id: page.id },
    data: { lastEditedById: callerId },
  });

  return { id: page.id, blockCount: doc.content?.length ?? 0 };
}
