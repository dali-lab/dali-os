// MCP file sharing: list_file_shares, plus the manage_document_sharing write
// actions. Thin wrappers over the same gate, audit and notify path the web route uses.

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
  principalType: { type: "string", enum: ["User", "Group"], description: "share_file / share_page: who the grant is for." },
  principalId: { type: "string", minLength: 1, description: "share_file / share_page: User.id or Group id." },
  permission: {
    type: "string",
    enum: ["View", "Comment", "Edit", "FullAccess"],
    description: "share_file / share_page: access level. Defaults to View. FullAccess lets them re-share.",
  },
  shareId: { type: "string", minLength: 1, description: "unshare_file / unshare_page: the share id from list_file_shares or list_page_shares." },
  linkAccess: {
    type: "string",
    enum: ["Restricted", "LabMembers"],
    description: "set_file_link_access / set_page_general_access: Restricted = only people you add; LabMembers = everyone in the lab.",
  },
  linkPermission: {
    type: "string",
    enum: ["View", "Comment", "Edit"],
    description: "set_file_link_access / set_page_general_access: level for lab members. Defaults to View.",
  },
};

export const LIST_FILE_SHARES_TOOL = {
  name: "list_file_shares",
  description:
    "List who a project file is shared with: each share's id, person or group, and permission, plus the file's link access and any access it inherits from its folder. Needs permission to manage the file's sharing. Use the share ids with manage_document_sharing unshare_file.",
  inputSchema: {
    type: "object" as const,
    properties: { fileId: { type: "string", minLength: 1 } },
    required: ["fileId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export const FILE_SHARING_REQUIRED: Record<string, string[]> = {
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

export async function runListFileShares(callerId: string, args: { fileId: string }) {
  return mapErrors(async () => {
    const context = await requireFileShareManager(args.fileId, callerId);
    return {
      file: context.file,
      linkAccess: context.linkAccess,
      linkPermission: context.linkPermission,
      inheritedFrom: context.inheritedAccess,
      shares: (await listFileShares(args.fileId)).map((s) => ({
        id: s.id,
        principalType: s.principalType,
        principalId: s.principalId,
        label: s.label,
        permission: s.permission,
      })),
    };
  });
}

export async function runFileSharingAction(
  callerId: string,
  action: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const fileId = String(args.fileId);
  return mapErrors(async () => {
    switch (action) {
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
