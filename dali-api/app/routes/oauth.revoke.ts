import type { Route } from "./+types/oauth.revoke";
import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { clearSessionCookie, parseBearerHeader } from "~/lib/cookies";
import { withCors, handlePreflight, preflightLoader } from "~/lib/cors";
import { safeJson } from "~/lib/safe-json";

export const loader = preflightLoader;

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  let token: string | undefined = parseBearerHeader(request) ?? undefined;

  if (!token) {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await safeJson<{ token?: string }>(request);
      if (body instanceof Response) return withCors(request, body);
      token = body.token;
    } else {
      const formData = await request.formData();
      token = formData.get("token") as string | undefined;
    }
  }

  if (token) {
    const current = await prisma.authSession.findUnique({
      where: { token },
      select: { id: true, userId: true, grantId: true },
    });
    if (current) await prisma.authSession.deleteMany({ where: { id: current.id } });
    if (current) {
      await logAuditEvent({
        action: "session.revoke",
        userId: current.userId,
        targetId: current.userId,
        metadata: {
          scope: "one",
          count: 1,
          via: "oauth.revoke",
          ...(current.grantId ? { grantId: current.grantId } : {}),
        },
        request,
      });
    }
  }

  const res = Response.json({});
  clearSessionCookie(res.headers);
  return withCors(request, res);
}
