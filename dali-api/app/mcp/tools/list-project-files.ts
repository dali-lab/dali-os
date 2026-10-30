// MCP `list_project_files` — files uploaded to a project. Read access for any
// authenticated member.

import { prisma } from "~/lib/db";
import { offsetPage, offsetWindow, pageProps, type PageArgs } from "../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const LIST_PROJECT_FILES_TOOL = {
  name: "list_project_files",
  description:
    "List files uploaded to a project (current version metadata). Excludes archived files unless includeArchived is true. Most recently updated first. Pass page.nextCursor as cursor to read the next page until page.hasMore is false.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      includeArchived: { type: "boolean" },
      ...pageProps(PAGE_LIMITS),
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = PageArgs & { projectId: string; includeArchived?: boolean };

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

  const window = offsetWindow(input, PAGE_LIMITS);
  const where = {
    projectId: input.projectId,
    ...(input.includeArchived ? {} : { archivedAt: null }),
  };
  const [fetched, total] = await Promise.all([
    prisma.projectFile.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip: window.skip,
    take: window.take,
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
    }),
    prisma.projectFile.count({ where }),
  ]);
  const { rows: files, page } = offsetPage(fetched, window, total);

  return {
    page,
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
