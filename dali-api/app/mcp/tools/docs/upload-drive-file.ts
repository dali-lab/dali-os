// MCP `upload_drive_file` — register an already-uploaded S3 file in the Lab
// or Member (My Drive) scope. Project-scope files are handled by the existing
// upload_project_file tool.
//
// The S3 upload itself must be done separately (e.g. via presign); this tool
// only records the metadata row and wires the version.
//
// ACCESS MODEL:
//   Lab scope    — caller must be a lab member; if folderPageId given, must
//                  have edit access to that folder page.
//   Member scope — any authenticated caller (the file is owned by the caller).
//                  If folderPageId given, must have edit access to it.

import { prisma } from "~/lib/db";
import { isLabMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { logAuditEvent } from "~/lib/audit";

export const UPLOAD_DRIVE_FILE_TOOL = {
  name: "upload_drive_file",
  description:
    "Register an already-uploaded S3 file in the Lab or Member (My Drive) scope. The S3 object must exist at the given key (from the presign endpoint). Lab scope requires lab membership; Member scope creates a private file owned by the caller. Optional folderPageId places the file in a Drive folder (requires edit access to that folder). Project-scope files use upload_project_file instead.",
  inputSchema: {
    type: "object" as const,
    properties: {
      s3Key: {
        type: "string",
        minLength: 1,
        description: "S3 object key (must start with 'uploads/').",
      },
      title: { type: "string", minLength: 1, maxLength: 200, description: "Human-facing file name." },
      fileName: {
        type: "string",
        minLength: 1,
        maxLength: 255,
        description: "Original client filename shown on download.",
      },
      contentType: { type: "string", minLength: 1, maxLength: 200, description: "MIME type." },
      sizeBytes: { type: "number", description: "File size in bytes (non-negative integer)." },
      scope: {
        type: "string",
        enum: ["Lab", "Member"],
        description: "'Lab' for lab-wide files; 'Member' for personal My Drive files.",
      },
      folderPageId: {
        type: "string",
        description: "Optional Drive folder page id to place the file in.",
      },
    },
    required: ["s3Key", "title", "fileName", "contentType", "sizeBytes", "scope"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export class UploadDriveFileError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "UploadDriveFileError";
  }
}

type Input = {
  s3Key: string;
  title: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  scope: "Lab" | "Member";
  folderPageId?: string;
};

export async function runUploadDriveFile(callerId: string, input: Input) {
  if (!input.s3Key.startsWith("uploads/")) {
    throw new UploadDriveFileError("Invalid file key — must start with 'uploads/'", 400);
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new UploadDriveFileError("sizeBytes must be a non-negative integer", 400);
  }

  const { scope, folderPageId } = input;

  // Validate destination folder access if given.
  if (folderPageId) {
    const folderAccess = await getPageAccess(callerId, folderPageId);
    if (!folderAccess.canEdit) {
      throw new UploadDriveFileError("No edit access to the target folder", 403);
    }
  }

  if (scope === "Lab") {
    if (!(await isLabMember(callerId))) {
      throw new UploadDriveFileError("Forbidden", 403);
    }
  }
  // Member scope: any authenticated caller; the file becomes theirs.

  const file = await prisma.$transaction(async (tx) => {
    const created = await tx.projectFile.create({
      data: {
        title: input.title,
        workspaceType: scope,
        workspaceId: scope === "Member" ? callerId : null,
        folderPageId: folderPageId ?? null,
      },
      select: { id: true },
    });
    const version = await tx.projectFileVersion.create({
      data: {
        fileId: created.id,
        s3Key: input.s3Key,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        uploadedById: callerId,
      },
      select: { id: true },
    });
    await tx.projectFile.update({
      where: { id: created.id },
      data: { currentVersionId: version.id },
    });
    return created;
  });

  await logAuditEvent({
    action: "projectFile.create",
    userId: callerId,
    targetId: file.id,
    metadata: { scope, title: input.title, folderPageId: folderPageId ?? null },
  }).catch((err) => console.error("upload_drive_file audit failed", err));

  return { id: file.id };
}
