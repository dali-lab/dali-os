// MCP `create_project_file_upload` + `finalize_project_file_upload` — the
// large-file path for project files (#1764). upload_project_file carries the
// bytes inside the tool call as base64, which caps out near 9 MB and costs the
// model tokens for every few bytes. Here the client sends the bytes straight to
// S3 and the tool calls carry only metadata:
//
//   1. create_project_file_upload → a presigned POST for a key this server
//      picks under uploads/project-files/<projectId>/. The signed policy pins
//      that exact key, caps the size at 100 MB and fixes the Content-Type, so
//      S3 enforces all three whatever the client sends.
//   2. The client POSTs the file (the returned curl command does it).
//   3. finalize_project_file_upload → reads the object's real size and type
//      back from S3 and adds it to the project's Files list.
//
// Gate on both steps: canEditProject (Core, or staffed on the project) — the
// same as upload_project_file.

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { getUploadPost, headObject, isS3Configured } from "~/lib/s3";
import {
  MAX_FILE_STORE_BYTES,
  MAX_FILE_STORE_LABEL,
  isBlockedUpload,
  uploadCapForKey,
} from "~/lib/file-validation";
import { McpForbiddenError, McpInvalidError, McpNotFoundError } from "./errors";
import { canEditProject } from "../access";
import { createProjectFileWithVersion, rawUploadSrc } from "../upload-project-file";

export const CREATE_PROJECT_FILE_UPLOAD_TOOL = {
  name: "create_project_file_upload",
  description: `Start uploading a file of up to ${MAX_FILE_STORE_LABEL} to a project, without base64. Returns a presigned S3 POST (uploadUrl + fields) and a ready curl command for a POSIX shell: run it with the local file path, expect HTTP 204, then call finalize_project_file_upload with the returned key to add the file to the project's Files list. To add the upload as a new version of an existing file instead, pass the key to manage_project_file add_version and skip finalize. The link expires after 15 minutes. If you send the POST yourself, send every field before the file part — S3 ignores fields after it. Requires Core or being staffed on the project.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      fileName: {
        type: "string",
        minLength: 1,
        maxLength: 255,
        description: "File name including extension, e.g. 'final-deck.pdf'.",
      },
      contentType: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "MIME type. It is signed into the upload: the Content-Type form field must match it exactly (the curl command sends it).",
      },
      sizeBytes: {
        type: "number",
        description: `Optional file size in bytes; a file over ${MAX_FILE_STORE_LABEL} is refused here instead of after the upload.`,
      },
    },
    required: ["projectId", "fileName", "contentType"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export const FINALIZE_PROJECT_FILE_UPLOAD_TOOL = {
  name: "finalize_project_file_upload",
  description:
    "Add a file uploaded through create_project_file_upload to the project's Files list. Call it after the POST returned HTTP 204. Size and type are read from storage, not taken from the caller. Calling it again with the same key returns the file already created. Requires Core or being staffed on the project.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      key: {
        type: "string",
        minLength: 1,
        maxLength: 1024,
        description: "The key returned by create_project_file_upload.",
      },
      fileName: {
        type: "string",
        minLength: 1,
        maxLength: 255,
        description:
          "Original file name shown on download. Defaults to the sanitized name in the key.",
      },
      title: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "Display name in the Files list. Defaults to fileName.",
      },
    },
    required: ["projectId", "key"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type CreateInput = {
  projectId: string;
  fileName: string;
  contentType: string;
  sizeBytes?: number;
};

type FinalizeInput = {
  projectId: string;
  key: string;
  fileName?: string;
  title?: string;
};

function projectKeyPrefix(projectId: string): string {
  return `uploads/project-files/${projectId}/`;
}

/** POSIX single-quote a value for the curl command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** `--form-string` for the policy fields so curl never reads a value as `@file`
 *  or splits a `;` inside a Content-Type; `-F` only for the file part, last.
 *  Prints the status on its own line: 204 on success, S3's error XML otherwise. */
function curlCommand(url: string, fields: Record<string, string>, fileName: string): string {
  // A literal backslash-n: curl expands it, and the command stays on one line.
  const parts = ["curl", "-sS", "-w", shellQuote("\\nHTTP %{http_code}\\n"), "-X", "POST", shellQuote(url)];
  for (const [name, value] of Object.entries(fields)) {
    parts.push("--form-string", shellQuote(`${name}=${value}`));
  }
  parts.push("-F", shellQuote(`file=@/path/to/${fileName}`));
  return parts.join(" ");
}

async function requireEditableProject(callerId: string, projectId: string): Promise<void> {
  if (!(await canEditProject(callerId, projectId))) throw new McpForbiddenError();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new McpNotFoundError("Project not found");
}

export async function runCreateProjectFileUpload(callerId: string, input: CreateInput) {
  await requireEditableProject(callerId, input.projectId);

  const fileName = input.fileName.trim();
  const contentType = input.contentType.trim().toLowerCase();
  if (!fileName) throw new McpInvalidError("fileName is required");
  if (isBlockedUpload(fileName, contentType)) {
    throw new McpInvalidError("File type not allowed");
  }
  if (input.sizeBytes !== undefined) {
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) {
      throw new McpInvalidError("sizeBytes must be a non-negative integer");
    }
    if (input.sizeBytes > MAX_FILE_STORE_BYTES) {
      throw new McpInvalidError(`File too large (max ${MAX_FILE_STORE_LABEL})`);
    }
  }
  if (!isS3Configured()) {
    throw new McpInvalidError("File storage is not configured in this environment");
  }

  const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  const key = `${projectKeyPrefix(input.projectId)}${crypto.randomUUID()}-${safeName}`;
  const cap = uploadCapForKey(key);
  const { url, fields } = await getUploadPost(key, contentType, {
    maxBytes: cap.maxBytes,
    expiresIn: cap.expiresIn,
  });

  return {
    key,
    uploadUrl: url,
    fields,
    maxBytes: cap.maxBytes,
    expiresAt: new Date(Date.now() + cap.expiresIn * 1000).toISOString(),
    curl: curlCommand(url, fields, safeName),
    next: "Replace /path/to/… with the local file path and run the curl command; a final line of HTTP 204 means stored. Then call finalize_project_file_upload with this key, or manage_project_file add_version to make it a new version of an existing file.",
  };
}

export async function runFinalizeProjectFileUpload(callerId: string, input: FinalizeInput) {
  await requireEditableProject(callerId, input.projectId);

  // Only keys minted for this project: a key from another project, or any other
  // upload, would otherwise become readable to this project's members. Create
  // mints exactly one segment after the prefix (safeName has no '/'), so any
  // further '/' — including a '../' — is not ours. A name like 'draft..pdf' is.
  const key = input.key.trim();
  const prefix = projectKeyPrefix(input.projectId);
  const rest = key.slice(prefix.length);
  if (!key.startsWith(prefix) || rest === "" || rest.includes("/")) {
    throw new McpInvalidError(
      "key is not an upload for this project — pass the key create_project_file_upload returned",
    );
  }

  // A retry after a dropped response must not add the file twice.
  const existing = await prisma.projectFileVersion.findFirst({
    where: { s3Key: key },
    select: { fileId: true },
  });
  if (existing) {
    return { fileId: existing.fileId, key, src: rawUploadSrc(key), alreadyFinalized: true };
  }

  let stored: Awaited<ReturnType<typeof headObject>>;
  try {
    stored = await headObject(key);
  } catch (err) {
    throw new McpInvalidError(
      err instanceof Error && /not configured/.test(err.message)
        ? "File storage is not configured in this environment"
        : // Without s3:ListBucket, S3 answers a missing key with 403, not 404 —
          // so this can also just mean the POST never happened.
          "Could not find the upload in storage. Make sure the POST from create_project_file_upload returned HTTP 204, then retry.",
    );
  }
  if (!stored) {
    throw new McpNotFoundError(
      "Nothing has been uploaded at that key yet. Run the POST from create_project_file_upload first (it returns HTTP 204 on success); the link expires 15 minutes after it was created.",
    );
  }
  // The signed policy already caps the size; this guards a key that reached the
  // bucket some other way.
  if (stored.sizeBytes > MAX_FILE_STORE_BYTES) {
    throw new McpInvalidError(`File too large (max ${MAX_FILE_STORE_LABEL})`);
  }

  const keyName = key.slice(prefix.length).replace(/^[0-9a-f-]{36}-/i, "");
  const fileName = (input.fileName ?? keyName).trim();
  const contentType = stored.contentType ?? "application/octet-stream";
  if (!fileName) throw new McpInvalidError("fileName is required");
  if (isBlockedUpload(fileName, contentType)) {
    throw new McpInvalidError("File type not allowed");
  }

  const title = (input.title ?? fileName).trim();
  const file = await createProjectFileWithVersion({
    projectId: input.projectId,
    title,
    s3Key: key,
    fileName,
    contentType,
    sizeBytes: stored.sizeBytes,
    uploadedById: callerId,
  });

  await logAuditEvent({
    action: "projectFile.create",
    userId: callerId,
    targetId: file.id,
    metadata: { projectId: input.projectId, title, sizeBytes: stored.sizeBytes, source: "mcp" },
  }).catch((err) => console.error("finalize_project_file_upload audit failed", err));

  return {
    fileId: file.id,
    title,
    key,
    sizeBytes: stored.sizeBytes,
    contentType,
    src: rawUploadSrc(key),
  };
}
