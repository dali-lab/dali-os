// MCP doc-tag tools.
//   list_doc_tags    — mcp:read   (any authenticated member)
//   manage_doc_tags  — mcp:admin  (Core: create, archive)
//   apply_doc_tag    — mcp:write  (Core: add/remove tag on doc or file)

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { requireForAction } from "~/mcp/registry";
import { logAuditEvent } from "~/lib/audit";

// ─── list_doc_tags ────────────────────────────────────────────────────────────

export const LIST_DOC_TAGS_TOOL = {
  name: "list_doc_tags",
  description: "List all active lab document/file tags sorted by label.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export class DocTagError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "DocTagError";
  }
}

export async function runListDocTags(_callerId: string, _input: Record<string, never>) {
  const tags = await prisma.docTag.findMany({
    where: { archivedAt: null },
    orderBy: { label: "asc" },
    select: { id: true, label: true, slug: true, color: true },
  });
  return tags;
}

// ─── manage_doc_tags (Core, mcp:admin) ───────────────────────────────────────

export const MANAGE_DOC_TAGS_TOOL = {
  name: "manage_doc_tags",
  description:
    "Manage lab doc tags (Core only). Actions: create (add a new tag, or revive an archived one with the same slug), archive (soft-delete by id).",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: ["create", "archive"] },
      label: { type: "string", minLength: 1, maxLength: 40, description: "For create." },
      color: { type: "string", maxLength: 32, description: "Optional color string for create." },
      tagId: { type: "string", description: "Required for archive." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

const TAG_ACTION_REQUIRED: Record<string, string[]> = {
  create: ["label"],
  archive: ["tagId"],
};

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "tag"
  );
}

type ManageTagInput = {
  action: "create" | "archive";
  label?: string;
  color?: string;
  tagId?: string;
};

export async function runManageDocTags(callerId: string, input: ManageTagInput) {
  if (!(await isCore(callerId))) throw new DocTagError("Forbidden", 403);
  requireForAction(input.action, input as Record<string, unknown>, TAG_ACTION_REQUIRED);

  if (input.action === "create") {
    const slug = slugify(input.label!);
    const existing = await prisma.docTag.findUnique({ where: { slug } });
    if (existing) {
      if (existing.archivedAt) {
        const revived = await prisma.docTag.update({
          where: { id: existing.id },
          data: { archivedAt: null, label: input.label!, color: input.color ?? existing.color },
          select: { id: true, label: true, slug: true, color: true },
        });
        return revived;
      }
      throw new DocTagError("A tag with that name already exists", 409);
    }
    const tag = await prisma.docTag.create({
      data: { label: input.label!, slug, color: input.color ?? null },
      select: { id: true, label: true, slug: true, color: true },
    });
    void logAuditEvent({
      action: "doctag.create",
      userId: callerId,
      targetId: tag.id,
      metadata: { label: tag.label, slug: tag.slug },
    }).catch((err) => console.error("manage_doc_tags audit failed", err));
    return tag;
  }

  // archive
  const tag = await prisma.docTag.findUnique({ where: { id: input.tagId! } });
  if (!tag) throw new DocTagError("Tag not found", 404);
  if (tag.archivedAt) throw new DocTagError("Tag is already archived", 400);
  await prisma.docTag.update({ where: { id: input.tagId! }, data: { archivedAt: new Date() } });
  return { ok: true };
}

// ─── apply_doc_tag (Core, mcp:write) ─────────────────────────────────────────

export const APPLY_DOC_TAG_TOOL = {
  name: "apply_doc_tag",
  description:
    "Add or remove a tag on a document (Page) or project file. Core only. op 'add' is idempotent; 'remove' is a no-op if the tag isn't applied.",
  inputSchema: {
    type: "object" as const,
    properties: {
      targetType: { type: "string", enum: ["doc", "file"] },
      targetId: { type: "string", minLength: 1 },
      tagId: { type: "string", minLength: 1 },
      op: { type: "string", enum: ["add", "remove"] },
    },
    required: ["targetType", "targetId", "tagId", "op"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type ApplyInput = {
  targetType: "doc" | "file";
  targetId: string;
  tagId: string;
  op: "add" | "remove";
};

export async function runApplyDocTag(callerId: string, input: ApplyInput) {
  if (!(await isCore(callerId))) throw new DocTagError("Forbidden", 403);

  const tag = await prisma.docTag.findUnique({ where: { id: input.tagId }, select: { id: true } });
  if (!tag) throw new DocTagError("Tag not found", 404);

  if (input.targetType === "doc") {
    const page = await prisma.page.findUnique({
      where: { id: input.targetId },
      select: { workspaceType: true, archivedAt: true },
    });
    if (
      !page ||
      (page.workspaceType !== "Project" && page.workspaceType !== "Lab") ||
      page.archivedAt !== null
    ) {
      throw new DocTagError("Document not found", 404);
    }
    if (input.op === "add") {
      await prisma.pageTag.upsert({
        where: { pageId_tagId: { pageId: input.targetId, tagId: input.tagId } },
        create: { pageId: input.targetId, tagId: input.tagId },
        update: {},
      });
    } else {
      await prisma.pageTag.deleteMany({
        where: { pageId: input.targetId, tagId: input.tagId },
      });
    }
    return { ok: true };
  }

  // file
  const file = await prisma.projectFile.findUnique({
    where: { id: input.targetId },
    select: { archivedAt: true },
  });
  if (!file || file.archivedAt !== null) throw new DocTagError("File not found", 404);
  if (input.op === "add") {
    await prisma.projectFileTag.upsert({
      where: { fileId_tagId: { fileId: input.targetId, tagId: input.tagId } },
      create: { fileId: input.targetId, tagId: input.tagId },
      update: {},
    });
  } else {
    await prisma.projectFileTag.deleteMany({
      where: { fileId: input.targetId, tagId: input.tagId },
    });
  }
  return { ok: true };
}
