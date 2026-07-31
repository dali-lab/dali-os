// MCP `read_page` — returns a Page's body as Markdown. Reads the persisted
// Yjs binary from CollabDocument as BlockNote blocks (readDocAsBlocks handles
// legacy pre-migration docs transparently) and renders Markdown via the
// server BlockNote codec. The doc name is derived from the page id
// (doc:{pageId}:body — the room DocEditor writes to); Page.contentDocId
// only overrides for seeded pages that point at a custom doc. Read access
// mirrors the web `authorizeCollabDoc` gate on the same doc room: Core
// everywhere, lab members on Lab pages, project members (or partner-visible
// partners) on Project pages, and the offering's instructors on
// EducationOffering pages.

import { prisma } from "~/lib/db";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToMarkdown } from "~/collab/blocknote-server";
import { pageDocName } from "~/collab/roomName";
import { authorizeCollabDoc } from "~/lib/collabAuth";

export const READ_PAGE_TOOL = {
  name: "read_page",
  description:
    "Read a workspace page's content as Markdown (headings, lists, check lists, quotes, code, tables, images). Lossy for editor-only blocks (callouts/toggles flatten; mentions render as @handle). Round-trips with set_page_content.",
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
    },
  });
  if (!page) throw new ReadPageError("Page not found", 404);

  // Gate the body read exactly like the web editor route does — the page's
  // workspace membership (Core / lab / project / instructor), not merely an
  // authenticated session. Without this, any mcp:read caller could read a
  // page's Markdown for a project they aren't on, or an instructor-only
  // EducationOffering page.
  if (!(await authorizeCollabDoc(callerId, pageDocName(page.id)))) {
    throw new ReadPageError("Forbidden", 403);
  }

  const blocks = await readDocAsBlocks(page.contentDocId ?? pageDocName(page.id));
  const markdown = blocks.length ? await blocksToMarkdown(blocks) : "";

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
