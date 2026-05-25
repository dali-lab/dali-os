import type { Route } from "./+types/api.files.$id";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";
import { getDownloadUrl } from "~/lib/s3";
import { hydrateAuthors } from "~/lib/collabAuth";

// GET    /api/files/:id           — version list (newest first) + signed download URLs
// POST   /api/files/:id           — rename: { intent: "rename", title }
//                                    new version: { intent: "version", s3Key, fileName, contentType, sizeBytes }
// DELETE /api/files/:id           — soft delete (archivedAt)
//
// Project files. Same permission model as project edit (isCore === Admin ||
// Core). Re-uploading appends a ProjectFileVersion and advances
// currentVersionId; old versions stay downloadable.

const RenameSchema = z.object({
  intent: z.literal("rename"),
  title: z.string().trim().min(1).max(200),
});

const VersionSchema = z.object({
  intent: z.literal("version"),
  s3Key: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().nonnegative(),
});

const BodySchema = z.discriminatedUnion("intent", [RenameSchema, VersionSchema]);

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const file = await prisma.projectFile.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      currentVersionId: true,
      archivedAt: true,
      versions: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fileName: true,
          contentType: true,
          sizeBytes: true,
          uploadedById: true,
          createdAt: true,
          s3Key: true,
        },
      },
    },
  });
  if (!file || file.archivedAt !== null) {
    return withCors(request, Response.json({ error: "File not found" }, { status: 404 }));
  }

  const uploaderNames = await hydrateAuthors(file.versions.map((v) => v.uploadedById));
  const nameById = new Map(uploaderNames.map((u) => [u.id, u.name]));

  // Sign a short-lived download URL per version. N is small (one row per
  // re-upload) so this stays cheap.
  const versions = await Promise.all(
    file.versions.map(async (v) => ({
      id: v.id,
      fileName: v.fileName,
      contentType: v.contentType,
      sizeBytes: v.sizeBytes,
      uploadedBy: nameById.get(v.uploadedById) ?? "Unknown",
      createdAt: v.createdAt.toISOString(),
      isCurrent: v.id === file.currentVersionId,
      downloadUrl: await getDownloadUrl(v.s3Key),
    })),
  );

  return withCors(request, Response.json({ id: file.id, title: file.title, versions }));
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (request.method !== "POST" && request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!(await isCore(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const file = await prisma.projectFile.findUnique({
    where: { id: params.id },
    select: { id: true, archivedAt: true },
  });
  if (!file || file.archivedAt !== null) {
    return withCors(request, Response.json({ error: "File not found" }, { status: 404 }));
  }

  if (request.method === "DELETE") {
    await prisma.projectFile.update({
      where: { id: file.id },
      data: { archivedAt: new Date() },
    });
    await logAuditEvent({
      action: "projectFile.delete",
      userId: auth.user.sub,
      targetId: file.id,
      metadata: { soft: true },
      request,
    });
    return withCors(request, Response.json({ ok: true }));
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }
  const body = parsed.data;

  if (body.intent === "rename") {
    await prisma.projectFile.update({
      where: { id: file.id },
      data: { title: body.title },
    });
    return withCors(request, Response.json({ ok: true }));
  }

  // intent === "version" — append a new version and make it current.
  if (!body.s3Key.startsWith("uploads/")) {
    return withCors(request, Response.json({ error: "Invalid file key" }, { status: 400 }));
  }
  const version = await prisma.projectFileVersion.create({
    data: {
      fileId: file.id,
      s3Key: body.s3Key,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      uploadedById: auth.user.sub,
    },
    select: { id: true },
  });
  await prisma.projectFile.update({
    where: { id: file.id },
    data: { currentVersionId: version.id },
  });
  await logAuditEvent({
    action: "projectFile.version",
    userId: auth.user.sub,
    targetId: file.id,
    metadata: { versionId: version.id },
    request,
  });
  return withCors(request, Response.json({ ok: true, versionId: version.id }));
}
