import { prisma } from "~/lib/db.server";
import { listPageShares, addPageShare, removePageShare, SharePrincipalError } from "~/lib/page-sharing.server";
import { describePageAudience } from "~/drive/lib/page-audience.server";
import {
  requirePageShareManager,
  setGeneralAccess,
  setFolderScope,
  notifyDocumentShared,
  PageShareForbiddenError,
  PageShareNotFoundError,
  GeneralAccessError,
} from "~/lib/page-share-access.server";
import { NoteForbiddenError, NoteNotFoundError } from "~/members/lib/personal-notes.server";
import { addNoteShare, removeNoteShare, setNoteVisibility } from "~/members/lib/personal-notes-actions.server";
import { McpForbiddenError, McpInvalidError, McpNotFoundError, requireForAction } from "../errors";
import { runSetDocumentSharing } from "./document-curation";
import type { McpCtx, McpTool } from "../registry";
import type { LinkAccess, ScopeKind, SharePermission, SharePrincipalType } from "~/generated/prisma/client";

const SHARE_PAGE_ACTIONS = ["share", "unshare", "set_general_access", "set_folder_access", "set_visibility"] as const;

const SHARE_PAGE_DEF = {
  name: "share_page",
  description:
    "Change who can open a page and where it shows. Actions: share (add a person or group), unshare (remove a share), set_general_access (everyone in the lab, or only people you add), set_folder_access (who can open a folder and everything in it), set_visibility (show a project page to its partner org or as the public write-up; on a personal note, make it public or private on the owner's profile). Works on lab, project and personal pages. You need permission to manage the page's sharing; only the owner can share a personal note. See who has access with get_sharing.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: [...SHARE_PAGE_ACTIONS] },
      pageId: { type: "string", minLength: 1 },
      principalType: { type: "string", enum: ["User", "Group"], description: "share." },
      principalId: { type: "string", minLength: 1, description: "share: User.id or Group id." },
      permission: {
        type: "string",
        enum: ["View", "Comment", "Edit", "FullAccess"],
        description: "share: defaults to View. FullAccess lets them re-share. Personal notes are always view-only.",
      },
      shareId: { type: "string", minLength: 1, description: "unshare: the share id from get_sharing." },
      linkAccess: {
        type: "string",
        enum: ["Restricted", "LabMembers"],
        description: "set_general_access: Restricted = only people you add; LabMembers = everyone in the lab.",
      },
      linkPermission: {
        type: "string",
        enum: ["View", "Comment", "Edit"],
        description: "set_general_access: level for lab members. Defaults to View.",
      },
      scopeKind: {
        type: "string",
        enum: ["Private", "Lab", "Group", "Inherit"],
        description:
          "set_folder_access: Private = only the owner and people named on each document; Lab = every lab member; Group = members of scopeGroupId; Inherit = follow the parent folder. Private and Group also switch every document inside to only people you add.",
      },
      scopeGroupId: { type: "string", minLength: 1, description: "set_folder_access: the group id when scopeKind is Group." },
      scopePermission: {
        type: "string",
        enum: ["View", "Comment", "Edit"],
        description: "set_folder_access: what people in the scope can do. Defaults to View for Lab, Edit otherwise.",
      },
      partnerVisible: { type: "boolean", description: "set_visibility: show to (or hide from) the project's partner org. Project pages only." },
      publicVisible: {
        type: "boolean",
        description: "set_visibility: use as the public write-up on dali.website (project pages), or make a personal note public (personal notes).",
      },
    },
    required: ["action", "pageId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  share: ["pageId", "principalType", "principalId"],
  unshare: ["pageId", "shareId"],
  set_general_access: ["pageId", "linkAccess"],
  set_folder_access: ["pageId", "scopeKind"],
  set_visibility: ["pageId"],
};

const PERMISSIONS = ["View", "Comment", "Edit", "FullAccess"];
const LINK_ACCESSES = ["Restricted", "LabMembers"];
const LINK_PERMISSIONS = ["View", "Comment", "Edit"];
const SCOPE_KINDS = ["Private", "Lab", "Group", "Inherit"];

async function mapErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PageShareNotFoundError || err instanceof NoteNotFoundError) {
      throw new McpNotFoundError(err.message);
    }
    if (err instanceof PageShareForbiddenError || err instanceof NoteForbiddenError) {
      throw new McpForbiddenError(err.message);
    }
    if (err instanceof SharePrincipalError || err instanceof GeneralAccessError) {
      throw new McpInvalidError(err.message);
    }
    throw err;
  }
}

function oneOf<T extends string>(v: unknown, allowed: string[], field: string, fallback?: T): T {
  if ((v === undefined || v === null) && fallback !== undefined) return fallback;
  if (typeof v !== "string" || !allowed.includes(v)) {
    throw new McpInvalidError(`${field} must be one of ${allowed.join(", ")}`);
  }
  return v as T;
}

async function isPersonalNote(pageId: string): Promise<boolean> {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { workspaceType: true } });
  if (!page) throw new McpNotFoundError("Document not found");
  return page.workspaceType === "Member";
}

export async function runGetPageShares(callerId: string, args: { pageId: string }) {
  return mapErrors(async () => {
    const context = await requirePageShareManager(args.pageId, callerId);
    const [shares, { inherited }] = await Promise.all([
      listPageShares(args.pageId),
      describePageAudience(callerId, args.pageId),
    ]);
    return {
      page: context.page,
      owner: context.owner ? { id: context.owner.id, name: context.owner.name } : null,
      linkAccess: context.linkAccess,
      linkPermission: context.linkPermission,
      folderAccess:
        context.page.kind === "Folder"
          ? { scopeKind: context.scopeKind, scopeGroupId: context.scopeGroupId, scopePermission: context.scopePermission }
          : null,
      inheritedFrom: inherited,
      shares: shares.map((s) => ({
        id: s.id,
        principalType: s.principalType,
        principalId: s.principalId,
        label: s.label,
        permission: s.permission,
      })),
    };
  });
}

async function runSharePage(callerId: string, args: Record<string, unknown>): Promise<unknown> {
  const action = args.action as string;
  requireForAction(action, args, ACTION_REQUIRED);
  const pageId = String(args.pageId);
  return mapErrors(async () => {
    switch (action) {
      case "share": {
        const principalType = oneOf<SharePrincipalType>(args.principalType, ["User", "Group"], "principalType");
        const permission = oneOf<SharePermission>(args.permission, PERMISSIONS, "permission", "View");
        const principalId = String(args.principalId);
        if (await isPersonalNote(pageId)) {
          return addNoteShare(pageId, callerId, principalType, principalId);
        }
        const context = await requirePageShareManager(pageId, callerId);
        const res = await addPageShare(pageId, callerId, principalType, principalId, permission);
        if (res.changed && principalType === "User" && principalId !== callerId) {
          await notifyDocumentShared({
            pageId,
            pageTitle: context.page.title,
            recipientUserId: principalId,
            actorId: callerId,
          });
        }
        return res;
      }
      case "unshare": {
        if (await isPersonalNote(pageId)) {
          await removeNoteShare(pageId, callerId, String(args.shareId));
          return { ok: true };
        }
        await requirePageShareManager(pageId, callerId);
        await removePageShare(pageId, String(args.shareId));
        return { ok: true };
      }
      case "set_general_access": {
        const linkAccess = oneOf<LinkAccess>(args.linkAccess, LINK_ACCESSES, "linkAccess");
        const linkPermission = oneOf<SharePermission>(args.linkPermission, LINK_PERMISSIONS, "linkPermission", "View");
        await requirePageShareManager(pageId, callerId);
        const result = await setGeneralAccess(pageId, callerId, { linkAccess, linkPermission });
        return { ok: true, ...result };
      }
      case "set_folder_access": {
        const kind = oneOf<string>(args.scopeKind, SCOPE_KINDS, "scopeKind");
        const scopeKind = kind === "Inherit" ? null : (kind as ScopeKind);
        if (scopeKind === "Group" && !args.scopeGroupId) {
          throw new McpInvalidError("scopeGroupId is required when scopeKind is Group");
        }
        const scopePermission =
          args.scopePermission === undefined || args.scopePermission === null
            ? null
            : oneOf<SharePermission>(args.scopePermission, LINK_PERMISSIONS, "scopePermission");
        await requirePageShareManager(pageId, callerId);
        const result = await setFolderScope(pageId, callerId, {
          scopeKind,
          scopeGroupId: scopeKind === "Group" ? String(args.scopeGroupId) : null,
          scopePermission,
        });
        return { ok: true, ...result };
      }
      case "set_visibility": {
        const partnerVisible = typeof args.partnerVisible === "boolean" ? args.partnerVisible : undefined;
        const publicVisible = typeof args.publicVisible === "boolean" ? args.publicVisible : undefined;
        if (await isPersonalNote(pageId)) {
          if (partnerVisible !== undefined) throw new McpInvalidError("Personal notes have no partner visibility");
          if (publicVisible === undefined) throw new McpInvalidError("action 'set_visibility' requires: publicVisible");
          await setNoteVisibility(pageId, callerId, publicVisible);
          return { ok: true, publicVisible };
        }
        return runSetDocumentSharing(callerId, { pageId, partnerVisible, publicVisible });
      }
      default:
        throw new McpInvalidError(`Unknown action '${action}'`);
    }
  });
}

export const SHARE_PAGE_TOOL: McpTool = {
  def: SHARE_PAGE_DEF,
  run: (ctx: McpCtx, args) => runSharePage(ctx.user.id, args),
};
