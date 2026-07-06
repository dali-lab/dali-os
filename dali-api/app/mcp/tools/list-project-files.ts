// MCP `list_project_files` — files uploaded to a project. Read access for any
// authenticated member.

import { prisma } from "~/lib/db";

export const LIST_PROJECT_FILES_TOOL = {
  name: "list_project_files",
  description:
    "List files uploaded to a project (current version metadata). Excludes archived files unless includeArchived is true.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      includeArchived: { type: "boolean" },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { projectId: string; includeArchived?: boolean };

export class ListProjectFilesError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ListProjectFilesError";
  }
}

export async function runListProjectFiles(_callerId: string, input: Input) {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });
  if (!project) throw new ListProjectFilesError("Project not found", 404);

  const files = await prisma.projectFile.findMany({
    where: {
      projectId: input.projectId,
      ...(input.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
      currentVersion: {
        select: {
          id: true,
          fileName: true,
          contentType: true,
          sizeBytes: true,
          createdAt: true,
        },
      },
    },
  });

  return {
    files: files.map((f) => ({
      id: f.id,
      title: f.title,
      archivedAt: f.archivedAt?.toISOString() ?? null,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
      currentVersion: f.currentVersion
        ? {
            id: f.currentVersion.id,
            fileName: f.currentVersion.fileName,
            contentType: f.currentVersion.contentType,
            sizeBytes: f.currentVersion.sizeBytes,
            uploadedAt: f.currentVersion.createdAt.toISOString(),
          }
        : null,
    })),
  };
}
