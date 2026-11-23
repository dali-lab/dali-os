import { prisma } from "~/lib/db.server";
import { isCore, isLabMemberOrAlum } from "~/lib/roles";
import { createLabPage, pageDepth, MAX_PAGE_DEPTH } from "~/lib/pages.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { duplicatePage } from "~/drive/lib/page-copy.server";
import { isRoot, ROOT_DELETE_ERROR, CLEARED_FOLDER_TYPE } from "~/drive/lib/drive-roots";
import { archiveDescendants } from "~/drive/lib/page-trash.server";
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
  if (!(await isLabMemberOrAlum(callerId))) {
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

// ─── create (via create_page) ────────────────────────────────────────────────

type CreateInput = {
  title: string;
  kind?: "FreeForm" | "Folder" | "Slides";
  parentPageId?: string;
  fromTemplatePageId?: string;
};

export async function runCreateLabDocument(callerId: string, input: CreateInput) {
  if (!(await isLabMemberOrAlum(callerId))) {
    throw new LabDocumentError("Forbidden", 403);
  }

  const kind = input.kind ?? "FreeForm";

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
    const depth = await pageDepth(input.parentPageId);
    if (depth < 0 || depth >= MAX_PAGE_DEPTH) {
      throw new LabDocumentError("Folder is too deeply nested", 400);
    }
    if (!(await getPageAccess(callerId, input.parentPageId)).canEdit) {
      throw new LabDocumentError("You can't put things in that folder", 403);
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

// ─── trash (via manage_drive_trash) ──────────────────────────────────────────

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

  const at = new Date();
  const archivedDescendants = await archiveDescendants(input.pageId, at, CLEARED_FOLDER_TYPE);
  await prisma.page.update({
    where: { id: input.pageId },
    data: { archivedAt: at, ...CLEARED_FOLDER_TYPE },
  });

  return { ok: true as const, archivedDescendants };
}
