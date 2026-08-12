// MCP document + file curation — who can see a project's documents and files,
// and removing them.
//
// The writing tools already existed (create_page / set_page_content /
// update_page / upload_project_file); what was missing was everything about
// *audience*: sharing a doc with the partner org, nominating one as the public
// write-up on dali.website, pinning it, and deleting docs or files.
//
// All of it is gated on requireProjectEditAccessForUser — Core or anyone
// staffed on the project — matching the HTTP routes these mirror.
//
// Page visibility goes through handlePageVisibility's sibling logic rather than
// writing the booleans directly, so partner and public sharing keep their audit
// events.

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { logAuditEvent, type AuditAction } from "~/lib/audit";

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

// The MCP equivalent of requireProjectEditAccess, which takes a Request.
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
      systemKey: true,
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
// The read half. `list_project_pages` returns titles and archive state but none
// of the audience flags, so there was no way to answer "what is this project
// showing its partner?" over MCP.

export const LIST_DOCUMENT_SHARING_TOOL = {
  name: "list_document_sharing",
  description:
    "List a project's documents and files with their sharing state — which are shared with the partner org, which is the public write-up on dali.website, and which are pinned. Use it before changing sharing.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      includeArchived: { type: "boolean", description: "Defaults to false." },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export type DocumentSharingOut = {
  pages: {
    id: string;
    title: string;
    kind: string;
    partnerVisible: boolean;
    publicVisible: boolean;
    pinned: boolean;
    archived: boolean;
    /** System pages (auto-created folders, the public write-up) can't be deleted. */
    system: boolean;
  }[];
  files: {
    id: string;
    title: string;
    partnerVisible: boolean;
    archived: boolean;
    fileName: string | null;
    sizeBytes: number | null;
  }[];
};

export async function runListDocumentSharing(
  callerId: string,
  input: { projectId: string; includeArchived?: boolean },
): Promise<DocumentSharingOut> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });
  if (!project) throw new CurationNotFoundError("Project");
  await requireProjectEdit(callerId, input.projectId);

  const archivedFilter = input.includeArchived ? {} : { archivedAt: null };
  const [pages, files] = await Promise.all([
    prisma.page.findMany({
      where: { workspaceType: "Project", workspaceId: input.projectId, ...archivedFilter },
      orderBy: { position: "asc" },
      select: {
        id: true,
        title: true,
        kind: true,
        partnerVisible: true,
        publicVisible: true,
        pinnedAt: true,
        archivedAt: true,
        systemKey: true,
      },
    }),
    prisma.projectFile.findMany({
      where: { projectId: input.projectId, ...archivedFilter },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        partnerVisible: true,
        archivedAt: true,
        currentVersion: { select: { fileName: true, sizeBytes: true } },
      },
    }),
  ]);

  return {
    pages: pages.map((p) => ({
      id: p.id,
      title: p.title,
      kind: p.kind,
      partnerVisible: p.partnerVisible,
      publicVisible: p.publicVisible,
      pinned: p.pinnedAt !== null,
      archived: p.archivedAt !== null,
      system: p.systemKey !== null,
    })),
    files: files.map((f) => ({
      id: f.id,
      title: f.title,
      partnerVisible: f.partnerVisible,
      archived: f.archivedAt !== null,
      fileName: f.currentVersion?.fileName ?? null,
      sizeBytes: f.currentVersion?.sizeBytes ?? null,
    })),
  };
}

// ─── set_document_sharing ────────────────────────────────────────────────────

export const SET_DOCUMENT_SHARING_TOOL = {
  name: "set_document_sharing",
  description:
    "Change a project document's audience: share it with the partner org, make it the project's public write-up on dali.website, and/or pin it. Pass only the flags you want to change. Note publicVisible puts the document's body on the public site as soon as the showcase card is Published.",
  inputSchema: {
    type: "object" as const,
    properties: {
      pageId: { type: "string", minLength: 1, description: "Page.id." },
      partnerVisible: {
        type: "boolean",
        description: "Share with (or unshare from) the project's partner org.",
      },
      publicVisible: {
        type: "boolean",
        description:
          "Use as the public write-up rendered under the showcase card on dali.website.",
      },
      pinned: { type: "boolean", description: "Pin to the top of the project's Documents block." },
    },
    required: ["pageId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runSetDocumentSharing(
  callerId: string,
  input: {
    pageId: string;
    partnerVisible?: boolean;
    publicVisible?: boolean;
    pinned?: boolean;
  },
): Promise<{ ok: true; partnerVisible: boolean; publicVisible: boolean; pinned: boolean }> {
  const page = await loadProjectPage(input.pageId);
  if (page.archivedAt !== null) {
    throw new CurationInvalidError("Archived documents can't be shared — restore it first");
  }
  await requireProjectEdit(callerId, page.workspaceId!);

  if (
    input.partnerVisible === undefined &&
    input.publicVisible === undefined &&
    input.pinned === undefined
  ) {
    throw new CurationInvalidError("Nothing to change");
  }

  const data: Record<string, unknown> = {};
  if (input.partnerVisible !== undefined) data.partnerVisible = input.partnerVisible;
  if (input.publicVisible !== undefined) data.publicVisible = input.publicVisible;
  if (input.pinned !== undefined) data.pinnedAt = input.pinned ? new Date() : null;

  const updated = await prisma.page.update({
    where: { id: input.pageId },
    data,
    select: { partnerVisible: true, publicVisible: true, pinnedAt: true },
  });

  // Same audit actions the HTTP toggles emit, so the project's Recent activity
  // card attributes MCP changes alongside UI ones.
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
    pinned: updated.pinnedAt !== null,
  };
}

// ─── delete_project_document ─────────────────────────────────────────────────

export const DELETE_PROJECT_DOCUMENT_TOOL = {
  name: "delete_project_document",
  description:
    "Archive or permanently delete a project document. Archiving is the default and is reversible; pass permanent: true to delete it and its body outright. System documents (auto-created meeting-note folders, the public write-up page) can't be deleted.",
  inputSchema: {
    type: "object" as const,
    properties: {
      pageId: { type: "string", minLength: 1 },
      permanent: {
        type: "boolean",
        description: "Delete rather than archive. Irreversible. Defaults to false.",
      },
    },
    required: ["pageId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runDeleteProjectDocument(
  callerId: string,
  input: { pageId: string; permanent?: boolean },
): Promise<{ ok: true; archived: boolean; deleted: boolean }> {
  const page = await loadProjectPage(input.pageId);
  await requireProjectEdit(callerId, page.workspaceId!);

  if (page.systemKey !== null) {
    throw new CurationInvalidError(
      "This is a system document (an auto-created folder or the public write-up) and can't be deleted",
    );
  }
  const childCount = await prisma.page.count({ where: { parentPageId: input.pageId } });
  if (childCount > 0) {
    throw new CurationInvalidError(
      `This folder still holds ${childCount} document(s) — move or delete them first`,
    );
  }

  if (!input.permanent) {
    await prisma.page.update({
      where: { id: input.pageId },
      data: { archivedAt: new Date(), partnerVisible: false, publicVisible: false },
    });
    return { ok: true, archived: true, deleted: false };
  }

  await prisma.$transaction(async (tx) => {
    await tx.collabDocument.deleteMany({ where: { name: `doc:${input.pageId}:body` } });
    await tx.page.delete({ where: { id: input.pageId } });
  });
  await logAuditEvent({
    action: "document.delete",
    userId: callerId,
    targetId: input.pageId,
    metadata: { projectId: page.workspaceId, title: page.title, via: "mcp" },
  });
  return { ok: true, archived: false, deleted: true };
}

// ─── set_file_sharing / delete_project_file ──────────────────────────────────

export const SET_FILE_SHARING_TOOL = {
  name: "set_file_sharing",
  description:
    "Share a project file with the project's partner org, or stop sharing it.",
  inputSchema: {
    type: "object" as const,
    properties: {
      fileId: { type: "string", minLength: 1, description: "ProjectFile.id." },
      partnerVisible: { type: "boolean" },
    },
    required: ["fileId", "partnerVisible"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

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

export const DELETE_PROJECT_FILE_TOOL = {
  name: "delete_project_file",
  description:
    "Archive a project file so it drops out of the Files list and stops being shared. Reversible in the app; the stored versions are kept.",
  inputSchema: {
    type: "object" as const,
    properties: {
      fileId: { type: "string", minLength: 1 },
    },
    required: ["fileId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

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

  // Archive rather than delete: versions carry uploader attribution and S3
  // keys, and the app's own Files UI archives too.
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
