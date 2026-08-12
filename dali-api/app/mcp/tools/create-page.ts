// MCP `create_page` — creates a Page in a project workspace: a FreeForm
// document (optionally seeded with Markdown content via the collab write
// pipeline) or a Folder container. Mirrors api.projects.$id.documents — same
// nesting rules (documents nest only inside Folders up to MAX_PAGE_DEPTH;
// folders never nest) and same gate (Core, or staffed on the project).

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";
import { markdownToBlocks } from "~/collab/blocknote-server";
import { replaceCollabDocContent } from "~/collab/write";
import { pageDocName } from "~/collab/roomName";
import { pageDepth, MAX_PAGE_DEPTH } from "~/lib/pages";

const MAX_MARKDOWN_LENGTH = 300_000;

export const CREATE_PAGE_TOOL = {
  name: "create_page",
  description:
    "Create a page in a project's workspace: a FreeForm document (optionally with Markdown content) or a Folder. Documents can nest under a top-level Folder; folders can't nest. Requires Core or being staffed on the project.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      kind: {
        type: "string",
        enum: ["FreeForm", "Folder"],
        description: "Default 'FreeForm' (a document). 'Folder' creates a container page.",
      },
      parentPageId: {
        type: "string",
        description: "Optional. Nest under this top-level Folder page (FreeForm only).",
      },
      content: {
        type: "string",
        maxLength: MAX_MARKDOWN_LENGTH,
        description:
          "Optional initial body as Markdown (FreeForm only) — same dialect as set_page_content.",
      },
      iconEmoji: { type: "string", maxLength: 8 },
    },
    required: ["projectId", "title"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  projectId: string;
  title: string;
  kind?: "FreeForm" | "Folder";
  parentPageId?: string;
  content?: string;
  iconEmoji?: string;
};

export class CreatePageError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "CreatePageError";
  }
}

export async function runCreatePage(callerId: string, input: Input) {
  if (!(await canEditProject(callerId, input.projectId))) {
    throw new CreatePageError("Forbidden", 403);
  }

  const title = input.title.trim();
  if (!title) throw new CreatePageError("Title is required", 400);

  const kind = input.kind ?? "FreeForm";
  if (kind === "Folder" && input.parentPageId) {
    throw new CreatePageError("Folders can't be nested inside another folder", 400);
  }
  if (kind === "Folder" && input.content !== undefined) {
    throw new CreatePageError("Folders have no body — omit content", 400);
  }

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });
  if (!project) throw new CreatePageError("Project not found", 404);

  let parentPageId: string | null = null;
  if (input.parentPageId && input.parentPageId !== "") {
    const parent = await prisma.page.findUnique({
      where: { id: input.parentPageId },
      select: {
        id: true,
        parentPageId: true,
        workspaceType: true,
        workspaceId: true,
        kind: true,
        archivedAt: true,
      },
    });
    if (!parent || parent.archivedAt !== null) {
      throw new CreatePageError("Parent page not found", 404);
    }
    if (parent.workspaceType !== "Project" || parent.workspaceId !== input.projectId) {
      throw new CreatePageError(
        "Parent page is not in this project's workspace",
        400,
      );
    }
    if (parent.kind !== "Folder") {
      throw new CreatePageError("Documents can only nest inside a folder", 400);
    }
    const depth = await pageDepth(parent.id);
    if (depth < 0 || depth >= MAX_PAGE_DEPTH) {
      throw new CreatePageError("Folder is too deeply nested", 400);
    }
    parentPageId = parent.id;
  }

  // Parse before creating so bad markdown doesn't leave an empty page behind.
  let blocks = null;
  if (input.content !== undefined && input.content !== "") {
    try {
      blocks = await markdownToBlocks(input.content);
    } catch {
      throw new CreatePageError("content markdown could not be parsed", 400);
    }
  }

  const last = await prisma.page.findFirst({
    where: {
      workspaceType: "Project",
      workspaceId: input.projectId,
      parentPageId,
    },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  const page = await prisma.page.create({
    data: {
      workspaceType: "Project",
      workspaceId: input.projectId,
      parentPageId,
      title,
      kind,
      position,
      iconEmoji: input.iconEmoji && input.iconEmoji !== "" ? input.iconEmoji : null,
      createdById: callerId,
      lastEditedById: blocks ? callerId : null,
    },
    select: { id: true },
  });

  if (blocks) {
    await replaceCollabDocContent(pageDocName(page.id), blocks, callerId);
  }

  return { id: page.id, kind, parentPageId, position };
}
