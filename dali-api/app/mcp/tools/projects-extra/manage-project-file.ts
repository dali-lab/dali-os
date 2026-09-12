// MCP `manage_project_file` — rename a project file or append a new version.
// Mirrors POST /api/files/:id (intent=rename / intent=version).
//
// Actions:
//   rename     — update the display title. Requires: fileId, title.
//   add_version — append a new version from an already-uploaded s3Key (use
//                 upload_project_file to obtain the key). Requires: fileId,
//                 s3Key, fileName, contentType, sizeBytes.
//
// Note: get_project_file (below) returns signed download URLs per version.
//
// Gate: canEditProject (Core or project member). Project files (workspaceType
// "Project") are the scope — lab-drive / My-Drive files are out of scope here.

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { notifyFileNewVersion } from "~/projects/lib/file-notifications.server";
import { McpNotFoundError, McpForbiddenError, McpInvalidError, requireForAction } from "./errors";
import { canEditProject } from "../access";

export const MANAGE_PROJECT_FILE_TOOL = {
  name: "manage_project_file",
  description: `Rename a project file or append a new version. action must be:
- \`rename\`: update the file's display name. Requires: fileId, title.
- \`add_version\`: append a new uploaded version. Obtain s3Key via upload_project_file first. Requires: fileId, s3Key, fileName, contentType, sizeBytes.

Requires Core or project-member access. Only project-workspace files are in scope.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["rename", "add_version"],
        description: "'rename' or 'add_version'.",
      },
      fileId: {
        type: "string",
        minLength: 1,
        description: "ProjectFile.id.",
      },
      // rename
      title: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "New display name (rename only).",
      },
      // add_version
      s3Key: {
        type: "string",
        minLength: 1,
        description: "S3 key returned by upload_project_file (add_version only).",
      },
      fileName: {
        type: "string",
        minLength: 1,
        maxLength: 255,
        description: "Original file name including extension (add_version only).",
      },
      contentType: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "MIME type of the file (add_version only).",
      },
      sizeBytes: {
        type: "number",
        minimum: 0,
        description: "File size in bytes (add_version only).",
      },
    },
    required: ["action", "fileId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  rename: ["fileId", "title"],
  add_version: ["fileId", "s3Key", "fileName", "contentType", "sizeBytes"],
};

type Input = {
  action: string;
  fileId: string;
  title?: string;
  s3Key?: string;
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
};

export async function runManageProjectFile(callerId: string, input: Input) {
  requireForAction(input.action, input, ACTION_REQUIRED);

  const file = await prisma.projectFile.findUnique({
    where: { id: input.fileId },
    select: {
      id: true,
      archivedAt: true,
      projectId: true,
      workspaceType: true,
    },
  });
  if (!file || file.archivedAt !== null) {
    throw new McpNotFoundError("File not found or archived");
  }
  if (file.workspaceType !== "Project" || !file.projectId) {
    throw new McpInvalidError(
      "manage_project_file only supports project-workspace files",
    );
  }

  if (!(await canEditProject(callerId, file.projectId))) {
    throw new McpForbiddenError();
  }

  if (input.action === "rename") {
    const title = input.title!.trim();
    if (!title) throw new McpInvalidError("title is required");
    await prisma.projectFile.update({
      where: { id: file.id },
      data: { title },
    });
    return { ok: true, fileId: file.id };
  }

  // add_version
  const s3Key = input.s3Key!;
  if (!s3Key.startsWith("uploads/")) {
    throw new McpInvalidError("Invalid file key — must start with 'uploads/'");
  }
  const sizeBytes = input.sizeBytes!;
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
    throw new McpInvalidError("sizeBytes must be a non-negative integer");
  }
  const version = await prisma.projectFileVersion.create({
    data: {
      fileId: file.id,
      s3Key,
      fileName: input.fileName!,
      contentType: input.contentType!,
      sizeBytes,
      uploadedById: callerId,
    },
    select: { id: true },
  });
  await prisma.projectFile.update({
    where: { id: file.id },
    data: { currentVersionId: version.id },
  });
  await logAuditEvent({
    action: "projectFile.version",
    userId: callerId,
    targetId: file.id,
    metadata: { versionId: version.id, source: "mcp" },
  });
  void notifyFileNewVersion({ fileId: file.id, uploadedById: callerId }).catch(
    (err) => console.error(`mcp manage_project_file: new version notify failed for ${file.id}`, err),
  );
  return { ok: true, fileId: file.id, versionId: version.id };
}
