// MCP tools for lab-wide documents (Pages with workspaceType=Lab).
// list_lab_documents (mcp:read), create_lab_document (mcp:write),
// delete_lab_document (mcp:write).

import { prisma } from "~/lib/db";
import { isCore, isLabMember } from "~/lib/roles";
import { createLabPage } from "~/lib/pages";
import { duplicatePage } from "~/lib/page-copy.server";
import { isRoot, ROOT_DELETE_ERROR, CLEARED_FOLDER_TYPE } from "~/lib/drive-roots";
import { offsetPage, offsetWindow, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

// ─── list_lab_documents ───────────────────────────────────────────────────────

export const LIST_LAB_DOCUMENTS_TOOL = {
  name: "list_lab_documents",
  description:
    "List lab-wide documents and folders visible to the caller. Returns non-archived Lab-workspace pages at the top level, or the children of parentPageId when given. Pass page.nextCursor as cursor to read the next page until page.hasMore is false.",
  inputSchema: {
    type: "object" as const,
    properties: {
      parentPageId: {
        type: "string",
        description: "If provided, return only pages nested under this folder.",
      },
      ...pageProps(PAGE_LIMITS),
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type ListInput = PageArgs & { parentPageId?: string };

export class LabDocumentError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "LabDocumentError";
  }
}

export async function runListLabDocuments(callerId: string, input: ListInput) {
  if (!(await isLabMember(callerId))) {
    throw new LabDocumentError("Forbidden", 403);
  }

  const where = {
    workspaceType: "Lab" as const,
    workspaceId: null,
    archivedAt: null,
    parentPageId: input.parentPageId ?? null,
  };
  const window = offsetWindow(input, PAGE_LIMITS);
  const [fetched, total] = await Promise.all([
    prisma.page.findMany({
      where,
      orderBy: [{ pinnedAt: "desc" }, { position: "asc" }, { id: "asc" }],
      skip: window.skip,
      take: window.take,
      select: {
        id: true,
        title: true,
        kind: true,
        parentPageId: true,
        pinnedAt: true,
        position: true,
        updatedAt: true,
        iconEmoji: true,
        tags: { select: { tag: { select: { id: true, label: true, color: true } } } },
      },
    }),
    prisma.page.count({ where }),
  ]);
  const { rows: pages, page } = offsetPage(fetched, window, total);

  return {
    page,
    documents: pages.map((p) => ({
      id: p.id,
      title: p.title,
      kind: p.kind,
      parentPageId: p.parentPageId,
      pinned: p.pinnedAt !== null,
      position: p.position,
      updatedAt: p.updatedAt.toISOString(),
      iconEmoji: p.iconEmoji,
      tags: p.tags.map((t) => t.tag),
    })),
  };
}

// ─── create_lab_document ──────────────────────────────────────────────────────

export const CREATE_LAB_DOCUMENT_TOOL = {
  name: "create_lab_document",
  description:
    "Create a new lab-wide document, folder, or slide deck. Any lab member may create. Folders can't be nested inside another folder (2-level cap). Fill a new slide deck with manage_slide_deck.",
  inputSchema: {
    type: "object" as const,
    properties: {
      title: { type: "string", minLength: 1, maxLength: 200 },
      kind: {
        type: "string",
        enum: ["FreeForm", "Folder", "Slides"],
        description: "Defaults to 'FreeForm'. 'Slides' creates an empty slide deck.",
      },
      parentPageId: {
        type: "string",
        description:
          "Nest this document under an existing top-level Lab folder. Omit for a top-level page.",
      },
      fromTemplatePageId: {
        type: "string",
        description:
          "Optional. Create the document by duplicating this template page's content (a Lab page marked as a template). FreeForm only.",
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type CreateInput = {
  title: string;
  kind?: "FreeForm" | "Folder" | "Slides";
  parentPageId?: string;
  fromTemplatePageId?: string;
};

export async function runCreateLabDocument(callerId: string, input: CreateInput) {
  if (!(await isLabMember(callerId))) {
    throw new LabDocumentError("Forbidden", 403);
  }

  const kind = input.kind ?? "FreeForm";

  if (kind === "Folder" && input.parentPageId) {
    throw new LabDocumentError("Folders can't be nested inside another folder", 400);
  }
  const fromTemplateId =
    input.fromTemplatePageId && input.fromTemplatePageId !== "" ? input.fromTemplatePageId : null;
  if (fromTemplateId && kind === "Folder") {
    throw new LabDocumentError("A folder can't be created from a template", 400);
  }

  if (input.parentPageId) {
    const parent = await prisma.page.findUnique({
      where: { id: input.parentPageId },
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
      parent.workspaceType !== "Lab" ||
      parent.workspaceId !== null
    ) {
      throw new LabDocumentError("Parent folder not found", 404);
    }
    if (parent.kind !== "Folder") {
      throw new LabDocumentError("Documents can only nest inside a folder", 400);
    }
    if (parent.parentPageId !== null) {
      throw new LabDocumentError("Pages only nest one level deep", 400);
    }
  }

  // From-template: duplicate a Lab template page's content into a new Lab page.
  if (fromTemplateId) {
    const template = await prisma.page.findUnique({
      where: { id: fromTemplateId },
      select: { isTemplate: true, archivedAt: true },
    });
    if (!template || template.archivedAt !== null || !template.isTemplate) {
      throw new LabDocumentError("Template page not found", 404);
    }
    const result = await duplicatePage({
      sourcePageId: fromTemplateId,
      createdById: callerId,
      titleOverride: input.title.trim(),
      workspaceTypeOverride: "Lab",
      workspaceIdOverride: null,
      parentPageIdOverride: input.parentPageId ?? null,
    });
    return { id: result.id };
  }

  const page = await createLabPage({
    title: input.title.trim(),
    createdById: callerId,
    kind,
    parentPageId: input.parentPageId ?? null,
  });

  return { id: page.id };
}

// ─── delete_lab_document ──────────────────────────────────────────────────────

export const DELETE_LAB_DOCUMENT_TOOL = {
  name: "delete_lab_document",
  description:
    "Archive a lab-wide document or folder. Requires Core access or being the creator of the document.",
  inputSchema: {
    type: "object" as const,
    properties: {
      pageId: {
        type: "string",
        minLength: 1,
        description: "ID of the lab document to archive.",
      },
    },
    required: ["pageId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type DeleteInput = { pageId: string };

export async function runDeleteLabDocument(callerId: string, input: DeleteInput) {
  const page = await prisma.page.findUnique({
    where: { id: input.pageId },
    select: {
      id: true,
      workspaceType: true,
      workspaceId: true,
      archivedAt: true,
      createdById: true,
      folderType: true,
    },
  });

  if (!page || page.workspaceType !== "Lab" || page.workspaceId !== null) {
    throw new LabDocumentError("Document not found", 404);
  }
  if (page.archivedAt !== null) {
    throw new LabDocumentError("Document is already archived", 400);
  }
  if (isRoot(page)) throw new LabDocumentError(ROOT_DELETE_ERROR, 400);

  const core = await isCore(callerId);
  if (!core && page.createdById !== callerId) {
    throw new LabDocumentError("Forbidden", 403);
  }

  await prisma.page.update({
    where: { id: input.pageId },
    data: { archivedAt: new Date(), ...CLEARED_FOLDER_TYPE },
  });

  return { ok: true };
}
