// MCP personal-note tools.
//   list_personal_notes   — mcp:read   (own + shared)
//   get_personal_note     — mcp:read   (single note with body access check)
//   manage_personal_note  — mcp:write  (faceted: create/update/delete/set_visibility/share_add/share_remove)

import { prisma } from "~/lib/db";
import { isLabMember } from "~/lib/roles";
import { requireForAction } from "~/mcp/registry";
import {
  noteAccess,
  groupIdsForUser,
  NoteForbiddenError,
  NoteNotFoundError,
} from "~/members/lib/personal-notes.server";
import {
  createNote,
  updateNote,
  setNoteVisibility,
  addNoteShare,
  removeNoteShare,
  deleteNote,
} from "~/members/lib/personal-notes-actions.server";

// ─── list_personal_notes ─────────────────────────────────────────────────────

export const LIST_PERSONAL_NOTES_TOOL = {
  name: "list_personal_notes",
  description:
    "List personal notes visible to the caller: own notes plus notes shared with them (by direct share or group). Returns note metadata without body content — use get_personal_note to read body.",
  inputSchema: {
    type: "object" as const,
    properties: {
      scope: {
        type: "string",
        enum: ["own", "shared"],
        description:
          "'own' for the caller's own notes (default); 'shared' for notes others shared with them.",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type ListInput = { scope?: "own" | "shared" };

export class PersonalNoteError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "PersonalNoteError";
  }
}

export async function runListPersonalNotes(callerId: string, input: ListInput) {
  if (!(await isLabMember(callerId))) {
    throw new PersonalNoteError("Forbidden", 403);
  }

  const scope = input.scope ?? "own";

  if (scope === "shared") {
    const groupIds = await groupIdsForUser(callerId);
    const rows = await prisma.page.findMany({
      where: {
        workspaceType: "Member",
        archivedAt: null,
        workspaceId: { not: callerId },
        OR: [
          { shares: { some: { principalType: "User", principalId: callerId } } },
          ...(groupIds.length
            ? [
                {
                  shares: {
                    some: { principalType: "Group" as const, principalId: { in: groupIds } },
                  },
                },
              ]
            : []),
        ],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        iconEmoji: true,
        kind: true,
        parentPageId: true,
        workspaceId: true,
        profileVisible: true,
        labListing: true,
        updatedAt: true,
        tags: { select: { tag: { select: { id: true, label: true, color: true } } } },
        _count: { select: { shares: true } },
      },
    });
    const ownerIds = [
      ...new Set(rows.map((r) => r.workspaceId).filter(Boolean) as string[]),
    ];
    const owners = await prisma.user.findMany({
      where: { id: { in: ownerIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const nameById = new Map(
      owners.map((o) => [o.id, `${o.firstName} ${o.lastName}`.trim()]),
    );
    return {
      notes: rows.map((p) => ({
        id: p.id,
        title: p.title,
        iconEmoji: p.iconEmoji,
        kind: p.kind,
        parentPageId: p.parentPageId,
        visibility: p.profileVisible ? "public" : "private",
        labListing: p.labListing,
        updatedAt: p.updatedAt.toISOString(),
        tags: p.tags.map((t) => t.tag),
        shareCount: p._count.shares,
        owner: p.workspaceId
          ? { id: p.workspaceId, name: nameById.get(p.workspaceId) ?? "Unknown" }
          : null,
      })),
    };
  }

  // Own notes
  const rows = await prisma.page.findMany({
    where: { workspaceType: "Member", workspaceId: callerId, archivedAt: null },
    orderBy: [{ parentPageId: "asc" }, { position: "asc" }],
    select: {
      id: true,
      title: true,
      iconEmoji: true,
      kind: true,
      parentPageId: true,
      workspaceId: true,
      profileVisible: true,
      labListing: true,
      updatedAt: true,
      tags: { select: { tag: { select: { id: true, label: true, color: true } } } },
      _count: { select: { shares: true } },
    },
  });

  return {
    notes: rows.map((p) => ({
      id: p.id,
      title: p.title,
      iconEmoji: p.iconEmoji,
      kind: p.kind,
      parentPageId: p.parentPageId,
      visibility: p.profileVisible ? "public" : "private",
      labListing: p.labListing,
      updatedAt: p.updatedAt.toISOString(),
      tags: p.tags.map((t) => t.tag),
      shareCount: p._count.shares,
      owner: null,
    })),
  };
}

// ─── get_personal_note ────────────────────────────────────────────────────────

export const GET_PERSONAL_NOTE_TOOL = {
  name: "get_personal_note",
  description:
    "Get a single personal note's metadata. Must have view access (own, shared, public, or lab-listed). To read the body content use read_page after verifying access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      pageId: { type: "string", minLength: 1 },
    },
    required: ["pageId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type GetInput = { pageId: string };

export async function runGetPersonalNote(callerId: string, input: GetInput) {
  let access;
  try {
    access = await noteAccess(input.pageId, callerId);
  } catch (err) {
    if (err instanceof NoteNotFoundError) throw new PersonalNoteError("Note not found", 404);
    throw err;
  }
  if (!access.canView) throw new PersonalNoteError("Forbidden", 403);

  const page = await prisma.page.findUnique({
    where: { id: input.pageId },
    select: {
      id: true,
      title: true,
      iconEmoji: true,
      kind: true,
      parentPageId: true,
      workspaceId: true,
      profileVisible: true,
      labListing: true,
      updatedAt: true,
      createdAt: true,
      tags: { select: { tag: { select: { id: true, label: true, color: true } } } },
      _count: { select: { shares: true } },
    },
  });
  if (!page) throw new PersonalNoteError("Note not found", 404);

  return {
    id: page.id,
    title: page.title,
    iconEmoji: page.iconEmoji,
    kind: page.kind,
    parentPageId: page.parentPageId,
    visibility: page.profileVisible ? "public" : "private",
    labListing: page.labListing,
    updatedAt: page.updatedAt.toISOString(),
    createdAt: page.createdAt.toISOString(),
    tags: page.tags.map((t) => t.tag),
    shareCount: page._count.shares,
    ownerId: page.workspaceId,
    canEdit: access.canEdit,
    isOwner: access.isOwner,
  };
}

// ─── manage_personal_note ─────────────────────────────────────────────────────

export const MANAGE_PERSONAL_NOTE_TOOL = {
  name: "manage_personal_note",
  description:
    "Manage a personal note. Owner-gated for all actions. Actions: create (own space), update (title/icon/parent), delete, set_visibility (public/private), share_add (share with user/group), share_remove (revoke a share).",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "delete", "set_visibility", "share_add", "share_remove"],
      },
      pageId: { type: "string", description: "Required for all actions except 'create'." },
      title: { type: "string", maxLength: 300, description: "For create/update." },
      iconEmoji: {
        type: "string",
        maxLength: 10,
        description: "For update. Empty string clears it.",
      },
      parentPageId: {
        type: "string",
        description: "For create/update. Empty string clears parent.",
      },
      isFolder: {
        type: "boolean",
        description: "For create only. Creates a folder instead of a note.",
      },
      isPublic: { type: "boolean", description: "For set_visibility." },
      principalType: {
        type: "string",
        enum: ["User", "Group"],
        description: "For share_add.",
      },
      principalId: { type: "string", description: "User or Group id for share_add." },
      shareId: { type: "string", description: "PageShare id for share_remove." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type ManageInput = {
  action: "create" | "update" | "delete" | "set_visibility" | "share_add" | "share_remove";
  pageId?: string;
  title?: string;
  iconEmoji?: string;
  parentPageId?: string;
  isFolder?: boolean;
  isPublic?: boolean;
  principalType?: "User" | "Group";
  principalId?: string;
  shareId?: string;
};

const ACTION_REQUIRED: Record<string, string[]> = {
  create: [],
  update: ["pageId"],
  delete: ["pageId"],
  set_visibility: ["pageId", "isPublic"],
  share_add: ["pageId", "principalType", "principalId"],
  share_remove: ["pageId", "shareId"],
};

export async function runManagePersonalNote(callerId: string, input: ManageInput) {
  requireForAction(input.action, input as Record<string, unknown>, ACTION_REQUIRED);

  try {
    switch (input.action) {
      case "create": {
        const created = await createNote(callerId, {
          title: input.title,
          parentPageId: input.parentPageId || null,
          isFolder: input.isFolder ?? false,
        });
        return { id: created.id };
      }
      case "update": {
        await updateNote(input.pageId!, callerId, {
          title: input.title,
          iconEmoji:
            input.iconEmoji !== undefined ? (input.iconEmoji || null) : undefined,
          parentPageId:
            input.parentPageId !== undefined
              ? (input.parentPageId || null)
              : undefined,
        });
        return { ok: true };
      }
      case "delete": {
        await deleteNote(input.pageId!, callerId);
        return { ok: true };
      }
      case "set_visibility": {
        await setNoteVisibility(input.pageId!, callerId, input.isPublic!);
        return { ok: true };
      }
      case "share_add": {
        const res = await addNoteShare(
          input.pageId!,
          callerId,
          input.principalType!,
          input.principalId!,
        );
        return res;
      }
      case "share_remove": {
        await removeNoteShare(input.pageId!, callerId, input.shareId!);
        return { ok: true };
      }
    }
  } catch (err) {
    if (err instanceof NoteNotFoundError) throw new PersonalNoteError("Note not found", 404);
    if (err instanceof NoteForbiddenError) throw new PersonalNoteError(err.message, 403);
    throw err;
  }
}
