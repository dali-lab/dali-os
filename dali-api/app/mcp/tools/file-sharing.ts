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
import { McpForbiddenError, McpInvalidError, McpNotFoundError, requireForAction } from "../errors";
import { runSetFileSharing } from "./document-curation";
import type { McpCtx, McpTool } from "../registry";
import type { LinkAccess, SharePermission, SharePrincipalType } from "~/generated/prisma/client";

const SHARE_FILE_ACTIONS = ["share", "unshare", "set_link_access", "set_partner_visibility"] as const;

const SHARE_FILE_DEF = {
  name: "share_file",
  description:
    "Change who can open a file and where it shows. Actions: share (add a person or group), unshare (remove a share), set_link_access (everyone in the lab, or only people you add), set_partner_visibility (show a project file to the project's partner org). You need permission to manage the file's sharing. See who has access with get_sharing.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: [...SHARE_FILE_ACTIONS] },
      fileId: { type: "string", minLength: 1 },
      principalType: { type: "string", enum: ["User", "Group"], description: "share." },
      principalId: { type: "string", minLength: 1, description: "share: User.id or Group id." },
      permission: {
        type: "string",
        enum: ["View", "Comment", "Edit", "FullAccess"],
        description: "share: defaults to View. FullAccess lets them re-share.",
      },
      shareId: { type: "string", minLength: 1, description: "unshare: the share id from get_sharing." },
      linkAccess: {
        type: "string",
        enum: ["Restricted", "LabMembers"],
        description: "set_link_access: Restricted = only people you add; LabMembers = everyone in the lab.",
      },
      linkPermission: {
        type: "string",
        enum: ["View", "Comment", "Edit"],
        description: "set_link_access: level for lab members. Defaults to View.",
      },
      partnerVisible: { type: "boolean", description: "set_partner_visibility: show to (or hide from) the partner org. Project files only." },
    },
    required: ["action", "fileId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  share: ["fileId", "principalType", "principalId"],
  unshare: ["fileId", "shareId"],
  set_link_access: ["fileId", "linkAccess"],
  set_partner_visibility: ["fileId", "partnerVisible"],
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

export async function runGetFileShares(callerId: string, args: { fileId: string }) {
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

async function runShareFile(callerId: string, args: Record<string, unknown>): Promise<unknown> {
  const action = args.action as string;
  requireForAction(action, args, ACTION_REQUIRED);
  const fileId = String(args.fileId);
  return mapErrors(async () => {
    switch (action) {
      case "share": {
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
      case "unshare": {
        await unshareFile({ fileId, actorId: callerId, shareId: String(args.shareId), via: "mcp" });
        return { ok: true };
      }
      case "set_link_access": {
        if (args.linkAccess !== "Restricted" && args.linkAccess !== "LabMembers") {
          throw new McpInvalidError("linkAccess must be Restricted or LabMembers");
        }
        await requireFileShareManager(fileId, callerId);
        const result = await setFileGeneralAccess(fileId, callerId, {
          linkAccess: args.linkAccess as LinkAccess,
          linkPermission: permissionArg(args.linkPermission, "View"),
        });
        return { ok: true, ...result };
      }
      case "set_partner_visibility":
        return runSetFileSharing(callerId, { fileId, partnerVisible: args.partnerVisible as boolean });
      default:
        throw new McpInvalidError(`Unknown action '${action}'`);
    }
  });
}

export const SHARE_FILE_TOOL: McpTool = {
  def: SHARE_FILE_DEF,
  run: (ctx: McpCtx, args) => runShareFile(ctx.user.id, args),
};
