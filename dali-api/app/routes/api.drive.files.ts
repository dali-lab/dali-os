import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { isCore, isLabMember, isProjectMember } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";
import { getPageAccess } from "~/lib/pageAccess.server";

// POST /api/drive/files
//
// Register an uploaded file (already in S3) under a drive scope — either the
// lab-wide drive or a project drive. The binary is uploaded to S3 first via
// /api/upload/presign; this route only records the metadata.
//
// Body:
//   s3Key        — S3 object key (must start with "uploads/")
//   title        — human-facing file name
//   fileName     — original client filename (shown on download)
//   contentType  — MIME type
//   sizeBytes    — byte count (non-negative integer)
//   scope        — { kind: "Lab" } | { kind: "Project", projectId: string }
//   folderPageId — optional; must be a Folder page in the same scope
//
// ACCESS:
//   Lab scope    → caller must be a lab member; if folderPageId is given the
//                  caller must have Edit access to that folder page.
//   Project scope → caller must be Core or a project member (same as the
//                   existing per-project file upload route).
//
// NO-WIDENING GUARANTEE: access checks mirror the existing per-surface rules
// exactly. A Lab-scope file is only visible to lab members; a project-scope
// file is only visible to project members / Core. This route does not change
// that contract — it simply allows Lab-scope files to exist.

const ScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("Lab") }),
  z.object({ kind: z.literal("Project"), projectId: z.string().trim().min(1) }),
]);

const CreateDriveFileSchema = z.object({
  s3Key: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().nonnegative(),
  scope: ScopeSchema,
  folderPageId: z.string().trim().min(1).optional(),
});

export async function action({ request }: { request: Request }) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const userId = auth.user.sub;

  const body = await parseJson(request, CreateDriveFileSchema);
  if (body instanceof Response) return withCors(request, body);

  // The presign route scopes every key under uploads/; reject anything that
  // didn't come through it.
  if (!body.s3Key.startsWith("uploads/")) {
    return withCors(request, Response.json({ error: "Invalid file key" }, { status: 400 }));
  }

  const { scope, folderPageId } = body;

  if (scope.kind === "Lab") {
    // Lab scope: caller must be a lab member.
    const member = await isLabMember(userId, request);
    if (!member) {
      return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
    }

    // If a folder is specified, the caller must have edit access to it.
    if (folderPageId) {
      const folderAccess = await getPageAccess(userId, folderPageId, request);
      if (!folderAccess.canEdit) {
        return withCors(
          request,
          Response.json({ error: "No edit access to the target folder" }, { status: 403 }),
        );
      }
    }

    // Create the file + first version atomically, then point the file at it.
    const file = await prisma.$transaction(async (tx) => {
      const created = await tx.projectFile.create({
        data: {
          // projectId intentionally null — this is a Lab-scope file.
          title: body.title,
          workspaceType: "Lab",
          workspaceId: null,
          folderPageId: folderPageId ?? null,
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
          uploadedById: userId,
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
      userId,
      targetId: file.id,
      metadata: { scope: "Lab", title: body.title, folderPageId: folderPageId ?? null },
      request,
    });

    return withCors(request, Response.json({ id: file.id }, { status: 201 }));
  }

  // Project scope: caller must be Core or a member of the project.
  const { projectId } = scope;

  const [core, projectMember] = await Promise.all([
    isCore(userId, request),
    isProjectMember(userId, projectId),
  ]);
  if (!core && !projectMember) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    return withCors(request, Response.json({ error: "Project not found" }, { status: 404 }));
  }

  const file = await prisma.$transaction(async (tx) => {
    const created = await tx.projectFile.create({
      data: {
        projectId,
        title: body.title,
        folderPageId: folderPageId ?? null,
        // workspaceType left null for project-scoped files — projectId is
        // the authoritative scope column for these rows.
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
        uploadedById: userId,
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
    userId,
    targetId: file.id,
    metadata: { scope: "Project", projectId, title: body.title },
    request,
  });

  return withCors(request, Response.json({ id: file.id }, { status: 201 }));
}
