import { z } from "zod";
import type { Route } from "./+types/api.drive.download";
import { requireMemberSession } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { filterViewableFiles } from "~/lib/fileAccess.server";
import { downloadFileName } from "~/lib/file-download-name";
import { buildDriveZip, MAX_ZIP_BYTES, MAX_ZIP_FILES } from "~/drive/lib/drive-download.server";
import { checkRateLimit } from "~/lib/rate-limit";
import { isS3Configured } from "~/lib/s3.server";
import { idSchema, parseJson } from "~/lib/validate";

// POST /api/drive/download { fileIds } — zips the files the caller can view and
// returns { url, included, skipped }. Files they can't view count as skipped, so
// the response doesn't say which ids exist.

const RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };
const MAX_IDS = 5000;

const BodySchema = z.object({ fileIds: z.array(idSchema).min(1).max(MAX_IDS) });

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return error("Method not allowed", 405);

  const gate = await requireMemberSession(request);
  if (!gate.ok) return gate.response;
  const userId = gate.auth.user.sub;

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return body;
  const fileIds = [...new Set(body.fileIds)];
  if (fileIds.length > MAX_ZIP_FILES) {
    return error(`Download up to ${MAX_ZIP_FILES} files at a time`, 413);
  }
  if (!isS3Configured()) return error("File storage isn't available", 503);

  const limited = checkRateLimit(request, RATE_LIMIT, `drive-download:${userId}`);
  if (limited) return limited;

  const rows = await prisma.projectFile.findMany({
    where: { id: { in: fileIds }, archivedAt: null },
    select: {
      id: true,
      title: true,
      projectId: true,
      workspaceType: true,
      workspaceId: true,
      folderPageId: true,
      linkAccess: true,
      linkPermission: true,
      currentVersion: {
        select: { id: true, fileName: true, s3Key: true, sizeBytes: true, createdAt: true },
      },
    },
  });

  const viewable = await filterViewableFiles(userId, rows, request);
  const files = viewable.flatMap((file) =>
    file.currentVersion ? [{ ...file, version: file.currentVersion }] : [],
  );
  if (files.length === 0) return error("No files to download", 404);

  const totalBytes = files.reduce((sum, f) => sum + f.version.sizeBytes, 0);
  if (totalBytes > MAX_ZIP_BYTES) {
    return error("That's over the 500 MB limit. Select fewer files.", 413);
  }

  const zip = await buildDriveZip(
    files.map((f) => ({
      name: downloadFileName(f.title, f.version.fileName),
      s3Key: f.version.s3Key,
      modified: f.version.createdAt,
    })),
  );
  if (!zip) return error("No files to download", 404);

  await logAuditEvent({
    action: "projectFile.bulk-download",
    userId,
    metadata: { fileIds: files.map((f) => f.id), bytes: totalBytes },
    request,
  });
  return Response.json({
    url: zip.url,
    included: zip.included,
    skipped: fileIds.length - zip.included,
  });
}
