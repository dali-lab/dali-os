import type { Route } from "./+types/api.education.$offeringId.files";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isOfferingManager } from "~/education/lib/access.server";
import { logAuditEvent } from "~/lib/audit";
import { parseJson } from "~/lib/validate";

// POST /api/education/:offeringId/files
//
// Register an uploaded file as an offering material. The binary is uploaded
// directly to S3 first via /api/upload/presign; this route only records the
// metadata: creates a ProjectFile (workspaceType=EducationOffering) + first
// ProjectFileVersion and places it in the offering's Drive folder.
//
// Permission: offering manager (instructor or Core).

const CreateFileSchema = z.object({
  title: z.string().trim().min(1).max(200),
  s3Key: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().nonnegative(),
  // Optional session link — when set, the file is treated as a session-specific
  // material. Validated to belong to this offering server-side.
  sessionId: z.string().optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const offeringId = params.offeringId!;
  if (!(await isOfferingManager(auth.user.sub, offeringId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJson(request, CreateFileSchema);
  if (body instanceof Response) return body;

  // The presign route scopes every key under uploads/; reject anything that
  // didn't come through it.
  if (!body.s3Key.startsWith("uploads/")) {
    return Response.json({ error: "Invalid file key" }, { status: 400 });
  }

  const offering = await prisma.educationOffering.findUnique({
    where: { id: offeringId },
    select: { id: true },
  });
  if (!offering) return Response.json({ error: "Offering not found" }, { status: 404 });

  // Validate sessionId belongs to this offering (when provided).
  if (body.sessionId) {
    const session = await prisma.educationSession.findUnique({
      where: { id: body.sessionId },
      select: { offeringId: true },
    });
    if (!session || session.offeringId !== offeringId) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
  }

  // Create the file + first version atomically, then point the file at it.
  // folderPageId is null so drive-scopes.server reparents this file under the
  // synthetic offering folder (the Projects pattern — no real folder Page needed).
  const file = await prisma.$transaction(async (tx) => {
    const created = await tx.projectFile.create({
      data: {
        workspaceType: "EducationOffering",
        workspaceId: offeringId,
        title: body.title,
        folderPageId: null,
      },
      select: { id: true },
    });
    const version = await tx.projectFileVersion.create({
      data: {
        fileId: created.id,
        s3Key: body.s3Key,
        fileName: body.fileName,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        uploadedById: auth.user.sub,
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
    userId: auth.user.sub,
    targetId: file.id,
    metadata: { offeringId, title: body.title },
    request,
  });

  return Response.json({ id: file.id }, { status: 201 });
}
