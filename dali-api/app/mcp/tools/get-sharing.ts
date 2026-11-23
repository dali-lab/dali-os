import { McpInvalidError } from "../errors";
import { runGetFileShares } from "./file-sharing";
import { runGetPageShares } from "./page-sharing";

export const GET_SHARING_TOOL = {
  name: "get_sharing",
  description:
    "Get who a page or a file is shared with: each share's id, person or group and permission, plus its general or link access and any access it inherits from a parent folder (folders also return their folder access). Pass pageId or fileId, not both. Needs permission to manage its sharing. Use the share ids with share_page or share_file unshare.",
  inputSchema: {
    type: "object" as const,
    properties: {
      pageId: { type: "string", minLength: 1, description: "A lab, project or personal page." },
      fileId: { type: "string", minLength: 1, description: "A project file." },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runGetSharing(callerId: string, args: { pageId?: string; fileId?: string }) {
  if (!args.pageId === !args.fileId) throw new McpInvalidError("Pass pageId or fileId, not both");
  return args.pageId ? runGetPageShares(callerId, { pageId: args.pageId }) : runGetFileShares(callerId, { fileId: args.fileId! });
}
