// MCP page sharing: list_page_shares, plus the manage_document_sharing page
// actions. Same gate, audit and notify path as POST /api/pages/:id/share.

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
import { McpForbiddenError, McpInvalidError, McpNotFoundError } from "../errors";
import type { LinkAccess, ScopeKind, SharePermission, SharePrincipalType } from "~/generated/prisma/client";

export const PAGE_SHARING_PROPERTIES = {
  scopeKind: {
    type: "string",
    enum: ["Private", "Lab", "Group", "Inherit"],
    description:
      "set_folder_access: Private = only the owner and people named on each document; Lab = every lab member; Group = members of scopeGroupId; Inherit = clear it and follow the parent folder. Private and Group switch every document inside to only people you add.",
  },
  scopeGroupId: { type: "string", minLength: 1, description: "set_folder_access: the group id when scopeKind is Group." },
  scopePermission: {
    type: "string",
    enum: ["View", "Comment", "Edit"],
    description: "set_folder_access: what people in the scope can do. Defaults to View for Lab, Edit otherwise.",
  },
};

export const LIST_PAGE_SHARES_TOOL = {
  name: "list_page_shares",
  description:
    "List who a document or folder (lab, project or personal) is shared with: each share's id, person or group, and permission, plus its general access, its folder access if it is a folder, and the access it inherits from a parent folder. Needs permission to manage the document's sharing. Use the share ids with manage_document_sharing unshare_page.",
  inputSchema: {
    type: "object" as const,
    properties: { pageId: { type: "string", minLength: 1 } },
    required: ["pageId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export const PAGE_SHARING_REQUIRED: Record<string, string[]> = {
  share_page: ["pageId", "principalType", "principalId"],
  unshare_page: ["pageId", "shareId"],
  set_page_general_access: ["pageId", "linkAccess"],
  set_folder_access: ["pageId", "scopeKind"],
};

const PERMISSIONS = ["View", "Comment", "Edit", "FullAccess"];
const LINK_ACCESSES = ["Restricted", "LabMembers"];
const LINK_PERMISSIONS = ["View", "Comment", "Edit"];
const SCOPE_KINDS = ["Private", "Lab", "Group", "Inherit"];

async function mapErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PageShareNotFoundError) throw new McpNotFoundError(err.message);
    if (err instanceof PageShareForbiddenError) throw new McpForbiddenError(err.message);
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

export async function runListPageShares(callerId: string, args: { pageId: string }) {
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

export async function runPageSharingAction(
  callerId: string,
  action: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const pageId = String(args.pageId);
  return mapErrors(async () => {
    switch (action) {
      case "share_page": {
        const principalType = oneOf<SharePrincipalType>(args.principalType, ["User", "Group"], "principalType");
        const permission = oneOf<SharePermission>(args.permission, PERMISSIONS, "permission", "View");
        const principalId = String(args.principalId);
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
      case "unshare_page": {
        await requirePageShareManager(pageId, callerId);
        await removePageShare(pageId, String(args.shareId));
        return { ok: true };
      }
      case "set_page_general_access": {
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
      default:
        throw new McpInvalidError(`Unknown action '${action}'`);
    }
  });
}
