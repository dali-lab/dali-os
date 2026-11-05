// MCP file sharing, reached through manage_document_sharing actions. Thin
// wrappers over the same gate, audit and notify path the web route uses.

import { listFileShares } from "~/lib/file-sharing.server";
import { SharePrincipalError } from "~/lib/page-sharing.server";
import {
  requireFileShareManager,
  setFileGeneralAccess,
  shareFileWith,
  unshareFile,
  FileShareForbiddenError,
  FileShareNotFoundError,
  FileGeneralAccessError,
} from "~/lib/file-share-access.server";
import { McpForbiddenError, McpInvalidError, McpNotFoundError } from "../errors";
import type { LinkAccess, SharePermission, SharePrincipalType } from "~/generated/prisma/client";

export const FILE_SHARING_PROPERTIES = {
  principalType: { type: "string", enum: ["User", "Group"], description: "share_file: who the grant is for." },
  principalId: { type: "string", minLength: 1, description: "share_file: User.id or Group id." },
  permission: {
    type: "string",
    enum: ["View", "Comment", "Edit", "FullAccess"],
    description: "share_file: access level. Defaults to View. FullAccess lets them re-share.",
  },
  shareId: { type: "string", minLength: 1, description: "unshare_file: the share id from list_file_shares." },
  linkAccess: {
    type: "string",
    enum: ["Restricted", "LabMembers"],
    description: "set_file_link_access: who can open the file by link.",
  },
  linkPermission: {
    type: "string",
    enum: ["View", "Comment", "Edit"],
    description: "set_file_link_access: level for lab members. Defaults to View.",
  },
};

export const FILE_SHARING_REQUIRED: Record<string, string[]> = {
  list_file_shares: ["fileId"],
  share_file: ["fileId", "principalType", "principalId"],
  unshare_file: ["fileId", "shareId"],
  set_file_link_access: ["fileId", "linkAccess"],
};

const PERMISSIONS = ["View", "Comment", "Edit", "FullAccess"];

async function mapErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof FileShareNotFoundError) throw new McpNotFoundError(err.message);
    if (err instanceof FileShareForbiddenError) throw new McpForbiddenError(err.message);
    if (err instanceof SharePrincipalError || err instanceof FileGeneralAccessError) {
      throw new McpInvalidError(err.message);
    }
    throw err;
  }
}

function permissionArg(v: unknown, fallback: SharePermission): SharePermission {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "string" || !PERMISSIONS.includes(v)) {
    throw new McpInvalidError(`permission must be one of ${PERMISSIONS.join(", ")}`);
  }
  return v as SharePermission;
}

export async function runFileSharingAction(
  callerId: string,
  action: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const fileId = String(args.fileId);
  return mapErrors(async () => {
    switch (action) {
      case "list_file_shares": {
        const context = await requireFileShareManager(fileId, callerId);
        return {
          file: context.file,
          linkAccess: context.linkAccess,
          linkPermission: context.linkPermission,
          inheritedFrom: context.inheritedAccess,
          shares: (await listFileShares(fileId)).map((s) => ({
            id: s.id,
            principalType: s.principalType,
            principalId: s.principalId,
            label: s.label,
            permission: s.permission,
          })),
        };
      }
      case "share_file": {
        if (args.principalType !== "User" && args.principalType !== "Group") {
          throw new McpInvalidError("principalType must be User or Group");
        }
        return shareFileWith({
          fileId,
          actorId: callerId,
          principalType: args.principalType as SharePrincipalType,
          principalId: String(args.principalId),
          permission: permissionArg(args.permission, "View"),
          via: "mcp",
        });
      }
      case "unshare_file": {
        await unshareFile({ fileId, actorId: callerId, shareId: String(args.shareId), via: "mcp" });
        return { ok: true };
      }
      case "set_file_link_access": {
        await requireFileShareManager(fileId, callerId);
        const result = await setFileGeneralAccess(fileId, callerId, {
          linkAccess: args.linkAccess as LinkAccess,
          linkPermission: permissionArg(args.linkPermission, "View"),
        });
        return { ok: true, ...result };
      }
      default:
        throw new McpInvalidError(`Unknown action '${action}'`);
    }
  });
}
