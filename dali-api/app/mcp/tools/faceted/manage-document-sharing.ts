import type { McpTool, McpCtx } from "../../registry";
import { McpInvalidError, requireForAction } from "../../errors";
import {
  SET_DOCUMENT_SHARING_PROPERTIES, SET_DOCUMENT_SHARING_REQUIRED,
  DELETE_PROJECT_DOCUMENT_PROPERTIES, DELETE_PROJECT_DOCUMENT_REQUIRED,
  SET_FILE_SHARING_PROPERTIES, SET_FILE_SHARING_REQUIRED,
  DELETE_PROJECT_FILE_PROPERTIES, DELETE_PROJECT_FILE_REQUIRED,
  runSetDocumentSharing,
  runDeleteProjectDocument,
  runSetFileSharing,
  runDeleteProjectFile,
} from "../document-curation";
import { FILE_SHARING_PROPERTIES, FILE_SHARING_REQUIRED, runFileSharingAction } from "../file-sharing";
import { PAGE_SHARING_PROPERTIES, PAGE_SHARING_REQUIRED, runPageSharingAction } from "../page-sharing";

const MANAGE_DOCUMENT_SHARING_DEF = {
  name: "manage_document_sharing",
  description: `Manage document and file audience/curation. Pass \`action\` to select the operation:
- \`set_document_sharing\`: change a document's audience (partner visibility, public write-up, pinned). Requires: pageId.
- \`delete_document\`: archive or permanently delete a project document. Requires: pageId.
- \`set_file_sharing\`: share a project file with the partner org, or stop sharing it. Requires: fileId, partnerVisible.
- \`delete_file\`: archive a project file so it drops out of the Files list. Requires: fileId.
- \`share_file\`: share a project file with a member or group. Requires: fileId, principalType, principalId.
- \`unshare_file\`: remove a share (ids from list_file_shares). Requires: fileId, shareId.
- \`set_file_link_access\`: set who can open the file by link. Requires: fileId, linkAccess.
- \`share_page\`: share a document or folder you manage (lab, project or personal) with a member or group. Requires: pageId, principalType, principalId.
- \`unshare_page\`: remove a document share (ids from list_page_shares). Requires: pageId, shareId.
- \`set_page_general_access\`: set whether everyone in the lab or only people you add can open a document. Requires: pageId, linkAccess.
- \`set_folder_access\`: set who can open a folder and everything in it. Private and Group also switch every document inside to only people you add. Requires: pageId, scopeKind (plus scopeGroupId for Group).`,
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
          "share_page",
          "unshare_page",
          "set_page_general_access",
          "set_folder_access",
        ],
        description: "Operation to perform.",
      },
      // set_document_sharing fields
      ...SET_DOCUMENT_SHARING_PROPERTIES,
      // delete_document fields
      ...DELETE_PROJECT_DOCUMENT_PROPERTIES,
      // set_file_sharing fields
      ...SET_FILE_SHARING_PROPERTIES,
      // delete_file fields
      ...DELETE_PROJECT_FILE_PROPERTIES,
      // file sharing fields
      ...FILE_SHARING_PROPERTIES,
      ...PAGE_SHARING_PROPERTIES,
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  set_document_sharing: SET_DOCUMENT_SHARING_REQUIRED,
  delete_document: DELETE_PROJECT_DOCUMENT_REQUIRED,
  set_file_sharing: SET_FILE_SHARING_REQUIRED,
  delete_file: DELETE_PROJECT_FILE_REQUIRED,
  ...FILE_SHARING_REQUIRED,
  ...PAGE_SHARING_REQUIRED,
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
    case "share_page":
    case "unshare_page":
    case "set_page_general_access":
    case "set_folder_access":
      return runPageSharingAction(ctx.user.id, action, rest);
    default:
      throw new McpInvalidError(`Unknown action '${action}'`);
  }
}

export const MANAGE_DOCUMENT_SHARING_TOOL: McpTool = { def: MANAGE_DOCUMENT_SHARING_DEF, run };
