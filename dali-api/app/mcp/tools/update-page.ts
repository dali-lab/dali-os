// MCP `update_page` — rename / re-icon / move / archive a project workspace
// page. Mirrors the app's rules (api.documents.$id.ts + api.projects.$id
// .documents.ts): documents nest only inside top-level Folders, system-managed
// pages (systemKey) can't be archived or moved, and archiving a Folder
// requires it to be empty. Archive is the Page model's soft delete, so this
// doubles as the delete tool — idempotent re-syncs unarchive/rename instead of
// duplicating. Gate mirrors web project-edit access: Core, or staffed on the
// page's project.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";
import { pageDepth, MAX_PAGE_DEPTH } from "~/lib/pages";

export const UPDATE_PAGE_TOOL = {
  name: "update_page",
  description:
    "Update a project workspace page: rename, set icon, move under a folder (or to top level), archive/unarchive (soft delete/restore). Requires Core or being staffed on the project.",
  inputSchema: {
    type: "object" as const,
    properties: {
      pageId: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      iconEmoji: {
        type: "string",
        maxLength: 8,
        description: "Empty string clears the icon.",
      },
      parentPageId: {
        type: "string",
        description:
          "Move under this top-level Folder page. Empty string moves to top level. Folders themselves can't be moved into folders.",
      },
      archived: {
        type: "boolean",
        description: "true soft-deletes (archives) the page; false restores it.",
      },
    },
    required: ["pageId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  pageId: string;
  title?: string;
  iconEmoji?: string;
  parentPageId?: string;
  archived?: boolean;
};

export class UpdatePageError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "UpdatePageError";
  }
}

export async function runUpdatePage(callerId: string, input: Input) {
  const page = await prisma.page.findUnique({
    where: { id: input.pageId },
    select: {
      id: true,
      workspaceType: true,
      workspaceId: true,
      parentPageId: true,
      kind: true,
      systemKey: true,
      archivedAt: true,
    },
  });
  if (!page || page.workspaceType !== "Project" || !page.workspaceId) {
    throw new UpdatePageError("Page not found", 404);
  }
  if (!(await canEditProject(callerId, page.workspaceId))) {
    throw new UpdatePageError("Forbidden", 403);
  }

  const data: {
    title?: string;
    iconEmoji?: string | null;
    parentPageId?: string | null;
    position?: number;
    archivedAt?: Date | null;
    lastEditedById?: string;
  } = {};

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new UpdatePageError("Title is required", 400);
    data.title = title;
    data.lastEditedById = callerId;
  }

  if (input.iconEmoji !== undefined) {
    data.iconEmoji = input.iconEmoji === "" ? null : input.iconEmoji;
  }

  if (input.parentPageId !== undefined && input.parentPageId !== (page.parentPageId ?? "")) {
    if (page.kind === "Folder") {
      throw new UpdatePageError("Folders can't be nested inside another folder", 400);
    }
    if (page.systemKey) {
      throw new UpdatePageError("System-managed pages can't be moved", 400);
    }
    const newParentId = input.parentPageId === "" ? null : input.parentPageId;
    if (newParentId) {
      const parent = await prisma.page.findUnique({
        where: { id: newParentId },
        select: {
          workspaceType: true,
          workspaceId: true,
          parentPageId: true,
          kind: true,
          archivedAt: true,
        },
      });
      if (
        !parent ||
        parent.archivedAt !== null ||
        parent.workspaceType !== "Project" ||
        parent.workspaceId !== page.workspaceId
      ) {
        throw new UpdatePageError("Parent folder not found", 404);
      }
      if (parent.kind !== "Folder") {
        throw new UpdatePageError("Documents can only nest inside a folder", 400);
      }
      const depth = await pageDepth(newParentId);
      if (depth < 0 || depth >= MAX_PAGE_DEPTH) {
        throw new UpdatePageError("Folder is too deeply nested", 400);
      }
    }
    const last = await prisma.page.findFirst({
      where: {
        workspaceType: "Project",
        workspaceId: page.workspaceId,
        parentPageId: newParentId,
      },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    data.parentPageId = newParentId;
    data.position = last ? last.position + 1 : 0;
  }

  if (input.archived !== undefined) {
    if (input.archived && !page.archivedAt) {
      if (page.systemKey) {
        throw new UpdatePageError("This default folder can't be archived", 400);
      }
      if (page.kind === "Folder") {
        const childCount = await prisma.page.count({
          where: { parentPageId: page.id, archivedAt: null },
        });
        if (childCount > 0) {
          throw new UpdatePageError(
            "Move or archive the documents inside this folder first",
            400,
          );
        }
      }
      data.archivedAt = new Date();
    } else if (!input.archived && page.archivedAt) {
      data.archivedAt = null;
    }
  }

  if (Object.keys(data).length === 0) {
    throw new UpdatePageError("Nothing to update", 400);
  }

  const updated = await prisma.page.update({
    where: { id: page.id },
    data,
    select: { id: true, title: true, iconEmoji: true, parentPageId: true, archivedAt: true },
  });

  return {
    id: updated.id,
    title: updated.title,
    iconEmoji: updated.iconEmoji,
    parentPageId: updated.parentPageId,
    archivedAt: updated.archivedAt?.toISOString() ?? null,
  };
}
