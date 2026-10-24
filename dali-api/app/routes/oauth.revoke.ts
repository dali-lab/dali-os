import type { Route } from "./+types/oauth.revoke";
import { revokeSession, hashSessionId } from "~/lib/session";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { clearSessionCookie, parseSessionId } from "~/lib/cookies";
import { withCors, handlePreflight, preflightLoader } from "~/lib/cors";
import { safeJson } from "~/lib/safe-json";

export const loader = preflightLoader;

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  // Cookie or Bearer first, then fall back to body `token`.
  let token: string | undefined = parseSessionId(request) ?? undefined;

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
    const legacy = await prisma.session.findUnique({
      where: { id: hashSessionId(token) },
      select: { userId: true, grantId: true, revokedAt: true },
    });
    await revokeSession(token);
    const current = await prisma.authSession.findUnique({
      where: { token },
      select: { id: true, userId: true, grantId: true },
    });
    if (current) await prisma.authSession.deleteMany({ where: { id: current.id } });
    const session = current ?? (legacy && !legacy.revokedAt ? legacy : null);
    if (session) {
      await logAuditEvent({
        action: "session.revoke",
        userId: session.userId,
        targetId: session.userId,
        metadata: {
          scope: "one",
          count: 1,
          via: "oauth.revoke",
          ...(session.grantId ? { grantId: session.grantId } : {}),
        },
        request,
      });
    }
  }

  const res = Response.json({});
  clearSessionCookie(res.headers);
  return withCors(request, res);
}
