// MCP `upload_project_file` — upload a file to a project from base64 content
// (an MCP client has no browser to run the presign → direct-POST flow, so the
// server writes to S3 itself via putObject). Two purposes:
//   "file"      (default) registers it in the project's Files list — the same
//               ProjectFile + first-ProjectFileVersion shape as
//               api.projects.$id.files.ts.
//   "pageImage" uploads without a Files entry, for embedding in page bodies:
//               pass the returned `src` to set_page_content as ![alt](src).
// Both return `src`, a stable session-authed URL (/api/upload/raw) that
// redirects to a fresh presigned S3 GET — a bare presigned URL would expire
// inside long-lived page content. Gate mirrors the app's file routes: Core,
// or staffed on the project.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";
import { putObject } from "~/lib/s3";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, isBlockedUpload } from "~/lib/file-validation";

// ~9 MB decoded — inside both the app's 10 MB upload cap and the MCP route's
// 13 MB JSON body limit (which would otherwise return an opaque 413).
const MAX_BASE64_LENGTH = 12_000_000;

export const UPLOAD_PROJECT_FILE_TOOL = {
  name: "upload_project_file",
  description:
    'Upload a file to a project from base64 content (max ~9 MB decoded). purpose "file" (default) adds it to the project\'s Files list; "pageImage" uploads an image for embedding in page bodies via set_page_content — use the returned src in ![alt](src). Requires Core or being staffed on the project.',
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      fileName: { type: "string", minLength: 1, maxLength: 255 },
      contentType: { type: "string", minLength: 1, maxLength: 200 },
      base64: { type: "string", minLength: 1, maxLength: MAX_BASE64_LENGTH },
      purpose: {
        type: "string",
        enum: ["file", "pageImage"],
        description: "Default 'file'. 'pageImage' requires an image/* contentType.",
      },
      title: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "Display name in the Files list (purpose 'file' only). Defaults to fileName.",
      },
    },
    required: ["projectId", "fileName", "contentType", "base64"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  projectId: string;
  fileName: string;
  contentType: string;
  base64: string;
  purpose?: "file" | "pageImage";
  title?: string;
};

export class UploadProjectFileError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "UploadProjectFileError";
  }
}

export function rawUploadSrc(key: string): string {
  return `/api/upload/raw?key=${encodeURIComponent(key)}`;
}

export async function runUploadProjectFile(callerId: string, input: Input) {
  if (!(await canEditProject(callerId, input.projectId))) {
    throw new UploadProjectFileError("Forbidden", 403);
  }

  const purpose = input.purpose ?? "file";
  const fileName = input.fileName.trim();
  const contentType = input.contentType.trim().toLowerCase();

  if (isBlockedUpload(fileName, contentType)) {
    throw new UploadProjectFileError("File type not allowed", 400);
  }
  if (purpose === "pageImage" && !contentType.startsWith("image/")) {
    throw new UploadProjectFileError("purpose 'pageImage' requires an image/* contentType", 400);
  }

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });
  if (!project) throw new UploadProjectFileError("Project not found", 404);

  let bytes: Buffer;
  try {
    bytes = Buffer.from(input.base64, "base64");
    // Node's decoder silently ignores invalid characters; round-trip length
    // check catches garbage input instead of uploading a truncated file.
    if (bytes.length === 0 || Math.abs(bytes.length - (input.base64.length * 3) / 4) > 3) {
      throw new Error("length mismatch");
    }
  } catch {
    throw new UploadProjectFileError("base64 could not be decoded", 400);
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new UploadProjectFileError(`File too large (max ${MAX_UPLOAD_LABEL})`, 400);
  }

  const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  const prefix = purpose === "pageImage" ? "doc-images" : "project-files";
  const key = `uploads/${prefix}/${input.projectId}/${crypto.randomUUID()}-${safeName}`;

  try {
    await putObject(key, bytes, contentType);
  } catch (err) {
    throw new UploadProjectFileError(
      err instanceof Error && /not configured/.test(err.message)
        ? "File storage is not configured in this environment"
        : "Upload to storage failed",
      400,
    );
  }

  if (purpose === "pageImage") {
    return { key, src: rawUploadSrc(key) };
  }

  const title = (input.title ?? fileName).trim();
  const file = await prisma.$transaction(async (tx) => {
    const created = await tx.projectFile.create({
      data: { projectId: input.projectId, title },
      select: { id: true },
    });
    const version = await tx.projectFileVersion.create({
      data: {
        fileId: created.id,
        s3Key: key,
        fileName,
        contentType,
        sizeBytes: bytes.length,
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

  return { fileId: file.id, title, key, src: rawUploadSrc(key) };
}
