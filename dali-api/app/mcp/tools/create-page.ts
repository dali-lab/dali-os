// MCP `create_page` — creates a FreeForm Page shell in a project workspace.
// Mirrors api.projects.$id.documents — title only; the rich-text body is
// initialized when first opened in the collab editor. (Pre-populating
// content would require synthesizing a Yjs binary update, which is out of
// scope for v1.) Core-only. Optionally nests under a parent page (1-level cap).

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";

export const CREATE_PAGE_TOOL = {
  name: "create_page",
  description:
    "Create a new free-form page in a project's workspace. Core-only. Title only; content is filled in via the collab editor.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      parentPageId: {
        type: "string",
        description:
          "Optional. Nest under this top-level page (2-level cap — the parent must be top-level).",
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
  parentPageId?: string;
  iconEmoji?: string;
};

export class CreatePageError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "CreatePageError";
  }
}

export async function runCreatePage(callerId: string, input: Input) {
  if (!(await isCore(callerId))) {
    throw new CreatePageError("Forbidden", 403);
  }

  const title = input.title.trim();
  if (!title) throw new CreatePageError("Title is required", 400);

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });
  if (!project) throw new CreatePageError("Project not found", 404);

  let parentPageId: string | null = null;
  if (input.parentPageId && input.parentPageId !== "") {
    const parent = await prisma.page.findUnique({
      where: { id: input.parentPageId },
      select: { id: true, parentPageId: true, workspaceType: true, workspaceId: true },
    });
    if (!parent) throw new CreatePageError("Parent page not found", 404);
    if (parent.workspaceType !== "Project" || parent.workspaceId !== input.projectId) {
      throw new CreatePageError(
        "Parent page is not in this project's workspace",
        400,
      );
    }
    if (parent.parentPageId !== null) {
      throw new CreatePageError("Parent page must itself be top-level (2-level cap)", 400);
    }
    parentPageId = parent.id;
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
      kind: "FreeForm",
      position,
      iconEmoji: input.iconEmoji && input.iconEmoji !== "" ? input.iconEmoji : null,
      createdById: callerId,
    },
    select: { id: true },
  });

  return { id: page.id, parentPageId, position };
}
