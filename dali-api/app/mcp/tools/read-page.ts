// MCP `read_page` — returns a Page's body as Markdown. Reads the persisted
// Yjs binary from CollabDocument (keyed by Page.contentDocId), decodes to
// ProseMirror JSON, and renders to Markdown via export-markdown.ts. Read
// access is any authenticated member.

import { prisma } from "~/lib/db";
import { collabDocToProseMirror } from "~/collab/export";
import { renderMarkdown } from "~/collab/export-markdown";

export const READ_PAGE_TOOL = {
  name: "read_page",
  description:
    "Read a workspace page's content as Markdown. Lossy for blocks outside the StarterKit set (tables, embeds render as plain text fallback).",
  inputSchema: {
    type: "object" as const,
    properties: {
      pageId: { type: "string", minLength: 1 },
    },
    required: ["pageId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { pageId: string };

export class ReadPageError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ReadPageError";
  }
}

export async function runReadPage(_callerId: string, input: Input) {
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
    },
  });
  if (!page) throw new ReadPageError("Page not found", 404);

  let markdown = "";
  if (page.contentDocId) {
    const doc = await collabDocToProseMirror(page.contentDocId);
    markdown = renderMarkdown(doc);
  }

  return {
    id: page.id,
    title: page.title,
    kind: page.kind,
    workspaceType: page.workspaceType,
    workspaceId: page.workspaceId,
    iconEmoji: page.iconEmoji,
    markdown,
  };
}
