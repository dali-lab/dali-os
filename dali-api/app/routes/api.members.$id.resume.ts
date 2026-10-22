// GET/POST/DELETE /api/members/:id/resume — a member's stored resume (PDF).
// GET is the member or an admin; POST and DELETE are the member only. Anyone
// else gets a 404 so the route doesn't reveal whether a resume exists.
//
// NEVER log the PDF, the prompt or the model output.

import type { Route } from "./+types/api.members.$id.resume";
import { randomUUID } from "node:crypto";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles, isAdmin } from "~/lib/roles";
import { isAiEnabled } from "~/lib/ai.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { checkRateLimit } from "~/lib/rate-limit";
import { deleteObject, getDownloadUrl, isS3Configured, putObject } from "~/lib/s3";
import { extractJobsFromPdf } from "~/members/lib/resume-extract.server";
import type { ImportedJob } from "~/members/lib/work-history-import";
import { AI_DAILY_MAX, secondsToUtcMidnight } from "./api.ai.meeting-notes";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
const EXTRACT_BURST = { max: 5, windowMs: 600_000 };

export type ResumeExtractError = "quota" | "rate" | "ai_unavailable" | "failed";

export type ResumeUploadResult = {
  resume: { fileName: string; uploadedAt: string };
  jobs?: ImportedJob[];
  extractError?: ResumeExtractError;
};

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

async function deleteQuietly(key: string): Promise<void> {
  try {
    await deleteObject(key);
  } catch {
    // The pointer is already gone; an orphaned object is the lesser failure.
  }
}

async function flagOn(userId: string, request: Request): Promise<boolean> {
  const roles = await getUserRoles(userId, request);
  return isFeatureEnabled("work-history-import", userId, roles, request);
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await flagOn(auth.user.sub, request))) return notFound();
  if (auth.user.sub !== params.id && !(await isAdmin(auth.user.sub))) return notFound();

  const member = await prisma.user.findUnique({
    where: { id: params.id },
    select: { resumeKey: true, resumeFileName: true },
  });
  if (!member?.resumeKey) return notFound();

  const url = await getDownloadUrl(member.resumeKey, {
    inline: true,
    contentType: "application/pdf",
    fileName: member.resumeFileName ?? "resume.pdf",
    expiresIn: 300,
  });
  if (auth.user.sub !== params.id) {
    await logAuditEvent({
      action: "member.resume.view",
      userId: auth.user.sub,
      targetId: params.id,
      metadata: { fileName: member.resumeFileName },
      request,
    });
  }
  return Response.redirect(url, 302);
}

async function extract(
  request: Request,
  userId: string,
  bytes: Uint8Array,
): Promise<Pick<ResumeUploadResult, "jobs" | "extractError">> {
  if (!isAiEnabled()) return { extractError: "ai_unavailable" };
  if (checkRateLimit(request, EXTRACT_BURST, `ai-work-history:${userId}`)) return { extractError: "rate" };

  const day = new Date().toISOString().slice(0, 10);
  const usage = await prisma.aiUsage.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (usage.count > AI_DAILY_MAX) return { extractError: "quota" };

  try {
    const result = await extractJobsFromPdf(bytes);
    await recordTokenUsage(userId, day, result.inputTokens, result.outputTokens);
    return { jobs: result.jobs };
  } catch {
    return { extractError: "failed" };
  }
}

async function upload(request: Request, userId: string): Promise<Response> {
  if (!isS3Configured()) {
    return Response.json({ error: "File storage is not configured." }, { status: 503 });
  }
  const tooLarge = () => Response.json({ error: "File too large (5 MB max)." }, { status: 413 });
  if (Number(request.headers.get("content-length") ?? "0") > MAX_RESUME_BYTES) return tooLarge();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Could not read the upload. Try again." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  }
  if (file.size > MAX_RESUME_BYTES) return tooLarge();

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!PDF_MAGIC.every((b, i) => bytes[i] === b)) {
    return Response.json({ error: "Upload a PDF." }, { status: 400 });
  }

  const previous = await prisma.user.findUnique({ where: { id: userId }, select: { resumeKey: true } });
  const key = `uploads/resumes/${userId}/${randomUUID()}.pdf`;
  await putObject(key, bytes, "application/pdf");
  const uploadedAt = new Date();
  const fileName = file.name.trim() || "resume.pdf";
  await prisma.user.update({
    where: { id: userId },
    data: {
      resumeKey: key,
      resumeFileName: fileName,
      resumeSizeBytes: bytes.byteLength,
      resumeUploadedAt: uploadedAt,
    },
  });
  if (previous?.resumeKey) await deleteQuietly(previous.resumeKey);
  await logAuditEvent({
    action: "member.resume.upload",
    userId,
    targetId: userId,
    metadata: { fileName, sizeBytes: bytes.byteLength, replaced: Boolean(previous?.resumeKey) },
    request,
  });

  const body: ResumeUploadResult = {
    resume: { fileName, uploadedAt: uploadedAt.toISOString() },
  };
  if (form.get("extract") === "1") {
    Object.assign(body, await extract(request, userId, bytes));
  }
  return Response.json(body);
}

async function remove(request: Request, userId: string): Promise<Response> {
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { resumeKey: true } });
  await prisma.user.update({
    where: { id: userId },
    data: { resumeKey: null, resumeFileName: null, resumeSizeBytes: null, resumeUploadedAt: null },
  });
  if (current?.resumeKey) await deleteQuietly(current.resumeKey);
  await logAuditEvent({ action: "member.resume.delete", userId, targetId: userId, request });
  return Response.json({ ok: true });
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST" && request.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (auth.user.sub !== params.id || !(await flagOn(auth.user.sub, request))) return notFound();

  return request.method === "POST" ? upload(request, auth.user.sub) : remove(request, auth.user.sub);
}
