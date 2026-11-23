import { prisma } from "~/lib/db.server";
import { canEditProject } from "./access";
import { parseMarkdown } from "../doc-markdown.server";
import { replaceCollabDocContent } from "~/collab/write";
import { pageDocName } from "~/collab/roomName";
import { pageDepth, MAX_PAGE_DEPTH } from "~/lib/pages.server";
import { duplicatePage } from "~/drive/lib/page-copy.server";
import { runCreateLabDocument } from "./docs/lab-documents";

const MAX_MARKDOWN_LENGTH = 300_000;

export const CREATE_PAGE_TOOL = {
  name: "create_page",
  description:
    "Create a page: a FreeForm document (optionally with Markdown content) or a Folder. With projectId the page goes in that project's workspace (needs Core or being staffed on the project); without it the page goes in the lab (any lab member at the top level, edit access to the folder inside one). Documents and folders nest inside any folder, up to 6 levels deep, as in the Drive.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1, description: "The project to create the page in. Omit to create a lab page." },
      title: { type: "string", minLength: 1, maxLength: 200 },
      kind: {
        type: "string",
        enum: ["FreeForm", "Folder"],
        description: "Default 'FreeForm' (a document). 'Folder' creates a container page.",
      },
      parentPageId: {
        type: "string",
        description: "Nest inside this folder in the same workspace (any depth up to 6 levels).",
      },
      content: {
        type: "string",
        maxLength: MAX_MARKDOWN_LENGTH,
        description:
          "Initial body as Markdown (project documents only), same dialect as edit_content: mention a member as [@handle](/members/<userId>), not @Name. Unknown ids are written as plain text and listed in warnings.",
      },
      fromTemplatePageId: {
        type: "string",
        description:
          "Create the document by duplicating this template page's content (a Lab page marked as a template). Mutually exclusive with 'content'; documents only.",
      },
      iconEmoji: { type: "string", maxLength: 8, description: "Project pages only." },
    },
    required: ["title"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  projectId?: string;
  title: string;
  kind?: "FreeForm" | "Folder";
  parentPageId?: string;
  content?: string;
  fromTemplatePageId?: string;
  iconEmoji?: string;
};

export class CreatePageError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "CreatePageError";
  }
}

export async function runCreatePage(callerId: string, input: Input) {
  if (!input.projectId) {
    if (input.content !== undefined) {
      throw new CreatePageError("Lab pages can't be created with content. Create the page, then fill it with edit_content", 400);
    }
    return runCreateLabDocument(callerId, input);
  }
  const projectId = input.projectId;
  if (!(await canEditProject(callerId, projectId))) {
    throw new CreatePageError("Forbidden", 403);
  }

  const title = input.title.trim();
  if (!title) throw new CreatePageError("Title is required", 400);

  const kind = input.kind ?? "FreeForm";
  if (kind === "Folder" && input.content !== undefined) {
    throw new CreatePageError("Folders have no body — omit content", 400);
  }
  const fromTemplateId =
    input.fromTemplatePageId && input.fromTemplatePageId !== "" ? input.fromTemplatePageId : null;
  if (fromTemplateId) {
    if (kind === "Folder") throw new CreatePageError("A folder can't be created from a template", 400);
    if (input.content !== undefined) {
      throw new CreatePageError("Pass either content or fromTemplatePageId, not both", 400);
    }
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
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
    if (parent.workspaceType !== "Project" || parent.workspaceId !== projectId) {
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

  // From-template: duplicate a Lab template page's content into this project.
  // duplicatePage byte-copies the collab doc and re-checks target access.
  if (fromTemplateId) {
    const template = await prisma.page.findUnique({
      where: { id: fromTemplateId },
      select: { isTemplate: true, archivedAt: true },
    });
    if (!template || template.archivedAt !== null || !template.isTemplate) {
      throw new CreatePageError("Template page not found", 404);
    }
    const result = await duplicatePage({
      sourcePageId: fromTemplateId,
      createdById: callerId,
      titleOverride: title,
      workspaceTypeOverride: "Project",
      workspaceIdOverride: projectId,
      parentPageIdOverride: parentPageId,
    });
    return { id: result.id, kind: "FreeForm" as const, parentPageId };
  }

  // Parse before creating so bad markdown doesn't leave an empty page behind.
  const { blocks, warnings } =
    input.content !== undefined && input.content !== ""
      ? await parseMarkdown(input.content)
      : { blocks: null, warnings: [] as string[] };

  const last = await prisma.page.findFirst({
    where: {
      workspaceType: "Project",
      workspaceId: projectId,
      parentPageId,
    },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  const page = await prisma.page.create({
    data: {
      workspaceType: "Project",
      workspaceId: projectId,
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

  return { id: page.id, kind, parentPageId, position, ...(warnings.length ? { warnings } : {}) };
}
