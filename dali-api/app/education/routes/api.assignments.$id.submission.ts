import type { Route } from "./+types/api.assignments.$id.submission";
import { requireAuth } from "~/lib/auth";
import { submitAssignment } from "~/education/lib/assignments-data";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

  const attachments = Array.isArray(body.attachments)
    ? body.attachments
        .map((a: unknown) => {
          if (!a || typeof a !== "object") return null;
          const row = a as { key?: unknown; name?: unknown; contentType?: unknown; size?: unknown };
          if (typeof row.key !== "string" || typeof row.name !== "string" || typeof row.contentType !== "string" || typeof row.size !== "number") {
            return null;
          }
          return { key: row.key, name: row.name, contentType: row.contentType, size: row.size };
        })
        .filter(Boolean) as { key: string; name: string; contentType: string; size: number }[]
    : [];

  try {
    const result = await submitAssignment({
      assignmentId: params.id,
      studentId: auth.user.sub,
      payload: {
        body: typeof body.body === "string" ? body.body : undefined,
        attachments,
      },
    });
    await logAuditEvent({
      action: "education.submission.submit",
      userId: auth.user.sub,
      targetId: result.id,
      metadata: { assignmentId: params.id, attachmentCount: attachments.length },
      request,
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Submit failed" },
      { status: 400 },
    );
  }
}
