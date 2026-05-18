import type { Route } from "./+types/api.submissions.$id.upload-post";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUploadPost } from "~/lib/s3";

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const submission = await prisma.educationSubmission.findUnique({
    where: { id: params.id! },
    select: { studentId: true },
  });
  if (!submission) return Response.json({ error: "Not found" }, { status: 404 });
  if (submission.studentId !== auth.user.sub) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as { filename: string; contentType: string };
  if (!body.filename || !body.contentType) {
    return Response.json({ error: "filename + contentType required" }, { status: 400 });
  }

  const safe = sanitizeFilename(body.filename);
  const key = `uploads/education/${params.id}/${Date.now()}-${safe}`;
  const post = await getUploadPost(key, body.contentType);
  return Response.json({ post, key });
}
