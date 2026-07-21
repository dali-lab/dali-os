// MCP `read_page` — returns a Page's body as Markdown. Reads the persisted
// Yjs binary from CollabDocument, decodes to ProseMirror JSON, and renders to
// Markdown via export-markdown.ts. The doc name is derived from the page id
// (doc:{pageId}:body — the room DocumentEditor writes to); Page.contentDocId
// only overrides for seeded pages that point at a custom doc. Read access is
// any authenticated member.

import { prisma } from "~/lib/db";
import { collabDocToProseMirror } from "~/collab/export";
import { renderMarkdown } from "~/collab/export-markdown";
import { pageDocName } from "~/collab/roomName";

export const READ_PAGE_TOOL = {
  name: "read_page",
  description:
    "Read a workspace page's content as Markdown (StarterKit set + images). Lossy for blocks outside that set (tables, embeds render as plain text fallback). Round-trips with set_page_content.",
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

  const doc = await collabDocToProseMirror(page.contentDocId ?? pageDocName(page.id));
  const markdown = doc.content?.length ? renderMarkdown(doc) : "";

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
