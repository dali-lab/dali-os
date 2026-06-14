import type { Route } from "./+types/api.projects.$id.files";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";

// POST /api/projects/:id/files
//
// Register an uploaded file as a project file. The binary is uploaded directly
// to S3 first via /api/upload/presign (which enforces type/size); this route
// only records the metadata: it creates a ProjectFile shell plus its first
// ProjectFileVersion and points currentVersionId at it. Same permission model
// as project edit (isCore === Admin || Core).

const CreateFileSchema = z.object({
  title: z.string().trim().min(1).max(200),
  s3Key: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().nonnegative(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const gate = await requireProjectEditAccess(request, params.id!);
  if (!gate.ok) return gate.response;
  const auth = gate.auth;

  const body = await parseJson(request, CreateFileSchema);
  if (body instanceof Response) return withCors(request, body);

  // The presign route scopes every key under uploads/; reject anything that
  // didn't come through it.
  if (!body.s3Key.startsWith("uploads/")) {
    return withCors(request, Response.json({ error: "Invalid file key" }, { status: 400 }));
  }

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!project) {
    return withCors(request, Response.json({ error: "Project not found" }, { status: 404 }));
  }

  // Create the file + first version atomically, then point the file at it.
  const file = await prisma.$transaction(async (tx) => {
    const created = await tx.projectFile.create({
      data: { projectId: params.id!, title: body.title },
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
    metadata: { projectId: params.id, title: body.title },
    request,
  });

  return withCors(request, Response.json({ id: file.id }, { status: 201 }));
}
