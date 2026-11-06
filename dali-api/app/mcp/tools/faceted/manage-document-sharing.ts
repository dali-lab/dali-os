import type { McpTool, McpCtx } from "../../registry";
import { McpInvalidError, requireForAction } from "../../errors";
import {
  SET_DOCUMENT_SHARING_TOOL,
  DELETE_PROJECT_DOCUMENT_TOOL,
  SET_FILE_SHARING_TOOL,
  DELETE_PROJECT_FILE_TOOL,
  runSetDocumentSharing,
  runDeleteProjectDocument,
  runSetFileSharing,
  runDeleteProjectFile,
} from "../document-curation";
import { FILE_SHARING_PROPERTIES, FILE_SHARING_REQUIRED, runFileSharingAction } from "../file-sharing";

const MANAGE_DOCUMENT_SHARING_DEF = {
  name: "manage_document_sharing",
  description: `Manage project document and file audience/curation. Pass \`action\` to select the operation:
- \`set_document_sharing\`: change a document's audience (partner visibility, public write-up, pinned). Requires: pageId.
- \`delete_document\`: archive or permanently delete a project document. Requires: pageId.
- \`set_file_sharing\`: share a project file with the partner org, or stop sharing it. Requires: fileId, partnerVisible.
- \`delete_file\`: archive a project file so it drops out of the Files list. Requires: fileId.
- \`share_file\`: share a project file with a member or group. Requires: fileId, principalType, principalId.
- \`unshare_file\`: remove a share (ids from list_file_shares). Requires: fileId, shareId.
- \`set_file_link_access\`: set who can open the file by link. Requires: fileId, linkAccess.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: [
          "set_document_sharing",
          "delete_document",
          "set_file_sharing",
          "delete_file",
          "share_file",
          "unshare_file",
          "set_file_link_access",
        ],
        description: "Operation to perform.",
      },
      // set_document_sharing fields
      ...SET_DOCUMENT_SHARING_TOOL.inputSchema.properties,
      // delete_document fields
      ...DELETE_PROJECT_DOCUMENT_TOOL.inputSchema.properties,
      // set_file_sharing fields
      ...SET_FILE_SHARING_TOOL.inputSchema.properties,
      // delete_file fields
      ...DELETE_PROJECT_FILE_TOOL.inputSchema.properties,
      // file sharing fields
      ...FILE_SHARING_PROPERTIES,
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  set_document_sharing: SET_DOCUMENT_SHARING_TOOL.inputSchema.required,
  delete_document: DELETE_PROJECT_DOCUMENT_TOOL.inputSchema.required,
  set_file_sharing: SET_FILE_SHARING_TOOL.inputSchema.required,
  delete_file: DELETE_PROJECT_FILE_TOOL.inputSchema.required,
  ...FILE_SHARING_REQUIRED,
};

async function run(ctx: McpCtx, args: Record<string, unknown>) {
  const action = args.action as string;
  requireForAction(action, args, ACTION_REQUIRED);

  const { action: _action, ...rest } = args;

  switch (action) {
    case "set_document_sharing":
      return runSetDocumentSharing(ctx.user.id, rest as any);
    case "delete_document":
      return runDeleteProjectDocument(ctx.user.id, rest as any);
    case "set_file_sharing":
      return runSetFileSharing(ctx.user.id, rest as any);
    case "delete_file":
      return runDeleteProjectFile(ctx.user.id, rest as any);
    case "share_file":
    case "unshare_file":
    case "set_file_link_access":
      return runFileSharingAction(ctx.user.id, action, rest);
    default:
      throw new McpInvalidError(`Unknown action '${action}'`);
  }
}

export const MANAGE_DOCUMENT_SHARING_TOOL: McpTool = { def: MANAGE_DOCUMENT_SHARING_DEF, run };
