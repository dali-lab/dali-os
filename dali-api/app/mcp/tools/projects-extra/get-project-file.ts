// MCP `get_project_file` — return full version history + signed download URLs
// for a single project file. Mirrors GET /api/files/:id.
//
// Gate: mcp:read (any authenticated member — communal project files are
// visible to all lab members, matching the web route's canViewFile default).

import { prisma } from "~/lib/db";
import { getDownloadUrl } from "~/lib/s3";
import { hydrateAuthors } from "~/lib/collabAuth";
import { UNKNOWN_LABEL } from "~/lib/display";
import { McpNotFoundError } from "./errors";

export const GET_PROJECT_FILE_TOOL = {
  name: "get_project_file",
  description:
    "Return metadata and signed download URLs for all versions of a project file (newest first). URLs expire in 1 hour. Use list_project_files to discover file ids.",
  inputSchema: {
    type: "object" as const,
    properties: {
      fileId: {
        type: "string",
        minLength: 1,
        description: "ProjectFile.id.",
      },
    },
    required: ["fileId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { fileId: string };

export async function runGetProjectFile(_callerId: string, input: Input) {
  const file = await prisma.projectFile.findUnique({
    where: { id: input.fileId },
    select: {
      id: true,
      title: true,
      currentVersionId: true,
      archivedAt: true,
      projectId: true,
      workspaceType: true,
      versions: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fileName: true,
          contentType: true,
          sizeBytes: true,
          uploadedById: true,
          createdAt: true,
          s3Key: true,
        },
      },
    },
  });
  if (!file || file.archivedAt !== null) {
    throw new McpNotFoundError("File not found or archived");
  }

  const uploaderNames = await hydrateAuthors(file.versions.map((v) => v.uploadedById));
  const nameById = new Map(uploaderNames.map((u) => [u.id, u.name]));

  const versions = await Promise.all(
    file.versions.map(async (v) => ({
      id: v.id,
      fileName: v.fileName,
      contentType: v.contentType,
      sizeBytes: v.sizeBytes,
      uploadedBy: nameById.get(v.uploadedById) ?? UNKNOWN_LABEL,
      uploadedAt: v.createdAt.toISOString(),
      isCurrent: v.id === file.currentVersionId,
      downloadUrl: await getDownloadUrl(v.s3Key),
    })),
  );

  return {
    id: file.id,
    title: file.title,
    versions,
  };
}
