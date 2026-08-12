// MCP `set_file_partner_visibility` — set whether a project file is shared
// with the partner portal.
//
// Mirrors POST /api/files/:id/partner-visible. The file must be live (not
// archived). Gate: canEditProject (Core or project member).

import { prisma } from "~/lib/db";
import { McpNotFoundError, McpForbiddenError } from "./errors";
import { canEditProject } from "../access";

export const SET_FILE_PARTNER_VISIBILITY_TOOL = {
  name: "set_file_partner_visibility",
  description:
    "Set whether a project file is visible in the partner portal. The file must be live (not archived).",
  inputSchema: {
    type: "object" as const,
    properties: {
      fileId: { type: "string", minLength: 1, description: "ProjectFile.id." },
      partnerVisible: {
        type: "boolean",
        description: "true to share with the partner portal, false to hide.",
      },
    },
    required: ["fileId", "partnerVisible"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type SetFilePartnerVisibilityInput = { fileId: string; partnerVisible: boolean };

export async function runSetFilePartnerVisibility(
  callerId: string,
  input: SetFilePartnerVisibilityInput,
): Promise<{ ok: true }> {
  const file = await prisma.projectFile.findUnique({
    where: { id: input.fileId },
    select: { id: true, projectId: true, archivedAt: true },
  });

  if (!file || file.archivedAt !== null) {
    throw new McpNotFoundError("File not found or is archived.");
  }

  if (!file.projectId) {
    throw new McpForbiddenError("Lab files don't have partner visibility.");
  }

  if (!(await canEditProject(callerId, file.projectId))) {
    throw new McpForbiddenError("You don't have permission to edit this project.");
  }

  await prisma.projectFile.update({
    where: { id: file.id },
    data: { partnerVisible: input.partnerVisible },
  });

  return { ok: true };
}
