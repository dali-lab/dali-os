import { prisma } from "~/lib/db.server";
import { isCore, isProjectMember } from "~/lib/roles";
import { CLEARED_FOLDER_TYPE } from "~/drive/lib/drive-roots";
import { archiveDescendants } from "./docs/trash-subtree";
import { logAuditEvent, type AuditAction } from "~/lib/audit";
import {
  keysetPage,
  keysetWindow,
  offsetPage,
  offsetWindow,
  pageProps,
  type PageArgs,
  type PageInfo,
} from "../pagination";

const SHARING_PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export class CurationNotFoundError extends Error {
  status = 404;
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "CurationNotFoundError";
  }
}

export class CurationForbiddenError extends Error {
  status = 403;
  constructor() {
    super("Only Core or a member staffed on this project can curate its documents");
    this.name = "CurationForbiddenError";
  }
}

export class CurationInvalidError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "CurationInvalidError";
  }
}

async function requireProjectEdit(callerId: string, projectId: string): Promise<void> {
  const [core, member] = await Promise.all([
    isCore(callerId),
    isProjectMember(callerId, projectId),
  ]);
  if (!core && !member) throw new CurationForbiddenError();
}

async function loadProjectPage(pageId: string) {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      title: true,
      workspaceType: true,
      workspaceId: true,
      archivedAt: true,
      partnerVisible: true,
      publicVisible: true,
      pinnedAt: true,
    },
  });
  if (!page || page.workspaceType !== "Project" || !page.workspaceId) {
    throw new CurationNotFoundError("Document");
  }
  return page;
}

// ─── list_document_sharing ───────────────────────────────────────────────────

export const LIST_DOCUMENT_SHARING_TOOL = {
  name: "list_document_sharing",
  description:
    "List a project's documents and files with their sharing state: which are shared with the partner org, which is the public write-up on dali.website, and which are pinned. Use it before changing sharing. Each call returns one kind, so call it once with kind \"pages\" and once with kind \"files\" to see both. Pass page.nextCursor as cursor to read the next page of that kind until page.hasMore is false.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      kind: {
        type: "string",
        enum: ["pages", "files"],
        description: "Which list to return: the project's documents or its files.",
      },
      includeArchived: { type: "boolean", description: "Defaults to false." },
      ...pageProps(SHARING_PAGE_LIMITS),
    },
    required: ["projectId", "kind"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export type SharingPageOut = {
  id: string;
  title: string;
  kind: string;
  partnerVisible: boolean;
  publicVisible: boolean;
  pinned: boolean;
  archived: boolean;
};

export type SharingFileOut = {
  id: string;
  title: string;
  partnerVisible: boolean;
  archived: boolean;
  fileName: string | null;
  sizeBytes: number | null;
};

export type DocumentSharingOut =
  | { kind: "pages"; page: PageInfo; pages: SharingPageOut[] }
  | { kind: "files"; page: PageInfo; files: SharingFileOut[] };

export async function runListDocumentSharing(
  callerId: string,
  input: PageArgs & { projectId: string; kind: "pages" | "files"; includeArchived?: boolean },
): Promise<DocumentSharingOut> {
  if (input.kind !== "pages" && input.kind !== "files") {
    throw new CurationInvalidError('kind must be "pages" or "files"');
  }
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });
  if (!project) throw new CurationNotFoundError("Project");
  await requireProjectEdit(callerId, input.projectId);

  const archivedFilter = input.includeArchived ? {} : { archivedAt: null };

  if (input.kind === "pages") {
    const window = offsetWindow(input, SHARING_PAGE_LIMITS);
    const where = { workspaceType: "Project" as const, workspaceId: input.projectId, ...archivedFilter };
    const [fetched, total] = await Promise.all([
      prisma.page.findMany({
        where,
        orderBy: [{ position: "asc" }, { id: "asc" }],
        skip: window.skip,
        take: window.take,
        select: {
          id: true,
          title: true,
          kind: true,
          partnerVisible: true,
          publicVisible: true,
          pinnedAt: true,
          archivedAt: true,
        },
      }),
      prisma.page.count({ where }),
    ]);
    const { rows, page } = offsetPage(fetched, window, total);
    return {
      kind: "pages",
      page,
      pages: rows.map((p) => ({
        id: p.id,
        title: p.title,
        kind: p.kind,
        partnerVisible: p.partnerVisible,
        publicVisible: p.publicVisible,
        pinned: p.pinnedAt !== null,
        archived: p.archivedAt !== null,
      })),
    };
  }

  const window = keysetWindow(
    input,
    SHARING_PAGE_LIMITS,
    [{ field: "createdAt", direction: "asc", type: "date" }],
    "asc",
  );
  const where = { projectId: input.projectId, ...archivedFilter };
  const [fetched, total] = await Promise.all([
    prisma.projectFile.findMany({
      where: { AND: [where, window.where] },
      orderBy: window.orderBy,
      take: window.take,
      select: {
        id: true,
        createdAt: true,
        title: true,
        partnerVisible: true,
        archivedAt: true,
        currentVersion: { select: { fileName: true, sizeBytes: true } },
      },
    }),
    prisma.projectFile.count({ where }),
  ]);
  const { rows, page } = keysetPage(fetched, window, total);
  return {
    kind: "files",
    page,
    files: rows.map((f) => ({
      id: f.id,
      title: f.title,
      partnerVisible: f.partnerVisible,
      archived: f.archivedAt !== null,
      fileName: f.currentVersion?.fileName ?? null,
      sizeBytes: f.currentVersion?.sizeBytes ?? null,
    })),
  };
}

// ─── share_page set_visibility ───────────────────────────────────────────────

export async function runSetDocumentSharing(
  callerId: string,
  input: {
    pageId: string;
    partnerVisible?: boolean;
    publicVisible?: boolean;
  },
): Promise<{ ok: true; partnerVisible: boolean; publicVisible: boolean }> {
  const page = await loadProjectPage(input.pageId);
  if (page.archivedAt !== null) {
    throw new CurationInvalidError("Archived documents can't be shared. Restore it first");
  }
  await requireProjectEdit(callerId, page.workspaceId!);

  if (input.partnerVisible === undefined && input.publicVisible === undefined) {
    throw new CurationInvalidError("Nothing to change");
  }

  const data: Record<string, unknown> = {};
  if (input.partnerVisible !== undefined) data.partnerVisible = input.partnerVisible;
  if (input.publicVisible !== undefined) data.publicVisible = input.publicVisible;

  const updated = await prisma.page.update({
    where: { id: input.pageId },
    data,
    select: { partnerVisible: true, publicVisible: true },
  });

  const audits: [boolean | undefined, AuditAction, string][] = [
    [input.partnerVisible, "page.partner-visibility", "partnerVisible"],
    [input.publicVisible, "page.public-visibility", "publicVisible"],
  ];
  for (const [value, action, field] of audits) {
    if (value === undefined) continue;
    await logAuditEvent({
      action,
      userId: callerId,
      targetId: input.pageId,
      metadata: { projectId: page.workspaceId, [field]: value, via: "mcp" },
    });
  }

  return {
    ok: true,
    partnerVisible: updated.partnerVisible,
    publicVisible: updated.publicVisible,
  };
}

// ─── trash a project page (via manage_drive_trash) ───────────────────────────

export async function runDeleteProjectDocument(
  callerId: string,
  input: { pageId: string },
): Promise<{ ok: true; archivedDescendants: number }> {
  const page = await loadProjectPage(input.pageId);
  await requireProjectEdit(callerId, page.workspaceId!);
  if (page.archivedAt !== null) throw new CurationInvalidError("Document is already in the trash");

  const data = { partnerVisible: false, publicVisible: false, ...CLEARED_FOLDER_TYPE };
  const archivedDescendants = await archiveDescendants(input.pageId, data);
  await prisma.page.update({ where: { id: input.pageId }, data: { archivedAt: new Date(), ...data } });
  return { ok: true, archivedDescendants };
}

// ─── share_file set_partner_visibility / trash a project file ────────────────

export async function runSetFileSharing(
  callerId: string,
  input: { fileId: string; partnerVisible: boolean },
): Promise<{ ok: true; partnerVisible: boolean }> {
  const file = await prisma.projectFile.findUnique({
    where: { id: input.fileId },
    select: { id: true, projectId: true, archivedAt: true },
  });
  if (!file) throw new CurationNotFoundError("File");
  if (file.archivedAt !== null) {
    throw new CurationInvalidError("Archived files can't be shared");
  }
  if (!file.projectId) throw new CurationInvalidError("Lab files don't have partner visibility");
  await requireProjectEdit(callerId, file.projectId);

  await prisma.projectFile.update({
    where: { id: input.fileId },
    data: { partnerVisible: input.partnerVisible },
  });
  await logAuditEvent({
    action: "projectFile.partner-visibility",
    userId: callerId,
    targetId: input.fileId,
    metadata: { projectId: file.projectId, partnerVisible: input.partnerVisible, via: "mcp" },
  });
  return { ok: true, partnerVisible: input.partnerVisible };
}

export async function runDeleteProjectFile(
  callerId: string,
  input: { fileId: string },
): Promise<{ ok: true; alreadyArchived: boolean }> {
  const file = await prisma.projectFile.findUnique({
    where: { id: input.fileId },
    select: { id: true, projectId: true, archivedAt: true, title: true },
  });
  if (!file) throw new CurationNotFoundError("File");
  if (!file.projectId) throw new CurationInvalidError("Lab files can't be deleted via this tool");
  await requireProjectEdit(callerId, file.projectId);

  if (file.archivedAt !== null) return { ok: true, alreadyArchived: true };

  await prisma.projectFile.update({
    where: { id: input.fileId },
    data: { archivedAt: new Date(), partnerVisible: false },
  });
  await logAuditEvent({
    action: "projectFile.delete",
    userId: callerId,
    targetId: input.fileId,
    metadata: { projectId: file.projectId, title: file.title, via: "mcp" },
  });
  return { ok: true, alreadyArchived: false };
}
