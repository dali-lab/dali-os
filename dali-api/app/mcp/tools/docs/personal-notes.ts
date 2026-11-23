import { prisma } from "~/lib/db.server";
import { isLabMemberOrAlum } from "~/lib/roles";
import { requireForAction } from "~/mcp/registry";
import {
  groupIdsForUser,
  NoteForbiddenError,
  NoteNotFoundError,
} from "~/members/lib/personal-notes.server";
import { createNote, updateNote } from "~/members/lib/personal-notes-actions.server";
import { offsetPage, offsetWindow, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

// ─── list_personal_notes ─────────────────────────────────────────────────────

export const LIST_PERSONAL_NOTES_TOOL = {
  name: "list_personal_notes",
  description:
    "List personal notes visible to the caller: own notes plus notes shared with them (by direct share or group). Returns note metadata without body content: use read_page to read a note. Pass page.nextCursor as cursor to read the next page until page.hasMore is false.",
  inputSchema: {
    type: "object" as const,
    properties: {
      scope: {
        type: "string",
        enum: ["own", "shared"],
        description:
          "'own' for the caller's own notes (default); 'shared' for notes others shared with them.",
      },
      ...pageProps(PAGE_LIMITS),
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type ListInput = PageArgs & { scope?: "own" | "shared" };

const NOTE_SELECT = {
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
} as const;

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
  if (!(await isLabMemberOrAlum(callerId))) {
    throw new PersonalNoteError("Forbidden", 403);
  }

  const scope = input.scope ?? "own";
  const window = offsetWindow(input, PAGE_LIMITS);

  if (scope === "shared") {
    const groupIds = await groupIdsForUser(callerId);
    const sharedWhere = {
        workspaceType: "Member" as const,
        archivedAt: null,
        workspaceId: { not: callerId },
        OR: [
          { shares: { some: { principalType: "User" as const, principalId: callerId } } },
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
    };
    const [fetched, total] = await Promise.all([
      prisma.page.findMany({
        where: sharedWhere,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: window.skip,
        take: window.take,
        select: NOTE_SELECT,
      }),
      prisma.page.count({ where: sharedWhere }),
    ]);
    const { rows, page } = offsetPage(fetched, window, total);
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
      page,
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
  const ownWhere = { workspaceType: "Member" as const, workspaceId: callerId, archivedAt: null };
  const [fetched, total] = await Promise.all([
    prisma.page.findMany({
      where: ownWhere,
      orderBy: [{ parentPageId: "asc" }, { position: "asc" }, { id: "asc" }],
      skip: window.skip,
      take: window.take,
      select: NOTE_SELECT,
    }),
    prisma.page.count({ where: ownWhere }),
  ]);
  const { rows, page } = offsetPage(fetched, window, total);

  return {
    page,
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

// ─── manage_personal_note ─────────────────────────────────────────────────────

export const MANAGE_PERSONAL_NOTE_TOOL = {
  name: "manage_personal_note",
  description:
    "Create or rename your own personal notes and folders. Actions: create (in your own space), update (title, icon or parent folder). Only the owner can change a note. Trash a note with manage_drive_trash; share it or make it public with share_page; read it with read_page.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: ["create", "update"] },
      pageId: { type: "string", description: "update: the note." },
      title: { type: "string", maxLength: 300, description: "create, update." },
      iconEmoji: {
        type: "string",
        maxLength: 10,
        description: "update: empty string clears it.",
      },
      parentPageId: {
        type: "string",
        description: "create, update: the parent folder. Empty string clears the parent.",
      },
      isFolder: {
        type: "boolean",
        description: "create: creates a folder instead of a note.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type ManageInput = {
  action: "create" | "update";
  pageId?: string;
  title?: string;
  iconEmoji?: string;
  parentPageId?: string;
  isFolder?: boolean;
};

const ACTION_REQUIRED: Record<string, string[]> = {
  create: [],
  update: ["pageId"],
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
    }
  } catch (err) {
    if (err instanceof NoteNotFoundError) throw new PersonalNoteError("Note not found", 404);
    if (err instanceof NoteForbiddenError) throw new PersonalNoteError(err.message, 403);
    throw err;
  }
}
