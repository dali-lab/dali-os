// MCP tools for lab-wide documents (Pages with workspaceType=Lab).
// list_lab_documents (mcp:read), create_lab_document (mcp:write),
// delete_lab_document (mcp:write).

import { prisma } from "~/lib/db";
import { isCore, isLabMember } from "~/lib/roles";
import { createLabPage } from "~/lib/pages";

// ─── list_lab_documents ───────────────────────────────────────────────────────

export const LIST_LAB_DOCUMENTS_TOOL = {
  name: "list_lab_documents",
  description:
    "List lab-wide documents and folders visible to the caller. Returns all non-archived Lab-workspace pages. Optionally filter to the children of a specific folder.",
  inputSchema: {
    type: "object" as const,
    properties: {
      parentPageId: {
        type: "string",
        description: "If provided, return only pages nested under this folder.",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type ListInput = { parentPageId?: string };

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

  const pages = await prisma.page.findMany({
    where: {
      workspaceType: "Lab",
      workspaceId: null,
      archivedAt: null,
      parentPageId: input.parentPageId ?? null,
    },
    orderBy: [{ pinnedAt: "desc" }, { position: "asc" }],
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
  });

  return {
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
    "Create a new lab-wide document or folder. Any lab member may create. Folders can't be nested inside another folder (2-level cap).",
  inputSchema: {
    type: "object" as const,
    properties: {
      title: { type: "string", minLength: 1, maxLength: 200 },
      kind: {
        type: "string",
        enum: ["FreeForm", "Folder"],
        description: "Defaults to 'FreeForm'.",
      },
      parentPageId: {
        type: "string",
        description:
          "Nest this document under an existing top-level Lab folder. Omit for a top-level page.",
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type CreateInput = { title: string; kind?: "FreeForm" | "Folder"; parentPageId?: string };

export async function runCreateLabDocument(callerId: string, input: CreateInput) {
  if (!(await isLabMember(callerId))) {
    throw new LabDocumentError("Forbidden", 403);
  }

  const kind = input.kind ?? "FreeForm";

  if (kind === "Folder" && input.parentPageId) {
    throw new LabDocumentError("Folders can't be nested inside another folder", 400);
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
    },
  });

  if (!page || page.workspaceType !== "Lab" || page.workspaceId !== null) {
    throw new LabDocumentError("Document not found", 404);
  }
  if (page.archivedAt !== null) {
    throw new LabDocumentError("Document is already archived", 400);
  }

  const core = await isCore(callerId);
  if (!core && page.createdById !== callerId) {
    throw new LabDocumentError("Forbidden", 403);
  }

  await prisma.page.update({
    where: { id: input.pageId },
    data: { archivedAt: new Date() },
  });

  return { ok: true };
}
