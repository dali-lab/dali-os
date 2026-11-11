import { parseCookies, serializeCookie, serializeSignedCookie } from "better-call";
import { redirectDocument } from "react-router";
import { logAuditEvent } from "~/lib/audit";
import { auth } from "~/lib/betterauth.server";
import { appendBetterAuthSessionCookie } from "~/lib/betterauth-cookie.server";
import { prisma } from "~/lib/db.server";
import { isAdmin } from "~/lib/roles";

const ADMIN_SESSION_COOKIE = "admin_session";

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// BetterAuth's stopImpersonating needs the impersonation session to still be
// live, so once it lapses the admin's own session (kept in the signed
// admin_session cookie) is only reachable by reading that cookie ourselves.
export async function restoreImpersonatingAdmin(
  request: Request,
): Promise<{ adminId: string; headers: Headers } | null> {
  const ctx = await auth.$context;
  const cookie = ctx.createAuthCookie(ADMIN_SESSION_COOKIE);
  const raw = parseCookies(request.headers.get("Cookie") ?? "").get(cookie.name);
  if (!raw) return null;

  const signed = decode(raw);
  const dot = signed.lastIndexOf(".");
  if (dot < 1) return null;
  const value = signed.slice(0, dot);
  const expected = (await serializeSignedCookie("v", value, ctx.secret)).slice(2).split(";")[0];
  if (decode(expected) !== signed) return null;

  const token = value.split(":")[0];
  if (!token) return null;
  const session = await prisma.authSession.findUnique({
    where: { token },
    select: { userId: true, expiresAt: true, impersonatedBy: true },
  });
  if (!session || session.impersonatedBy || session.expiresAt <= new Date()) return null;
  if (!(await isAdmin(session.userId))) return null;

  const headers = new Headers();
  await appendBetterAuthSessionCookie(headers, token);
  headers.append("Set-Cookie", clearAdminSessionCookie(cookie));
  return { adminId: session.userId, headers };
}

export async function redirectRestoringAdmin(request: Request, to: string): Promise<Response | null> {
  const restored = await restoreImpersonatingAdmin(request);
  if (!restored) return null;
  await logAuditEvent({
    action: "admin.impersonate.stop",
    userId: restored.adminId,
    metadata: { reason: "expired" },
    request,
  });
  return redirectDocument(to, { headers: restored.headers });
}

export async function clearAdminSessionCookieHeader(): Promise<string> {
  const ctx = await auth.$context;
  return clearAdminSessionCookie(ctx.createAuthCookie(ADMIN_SESSION_COOKIE));
}

function clearAdminSessionCookie(cookie: { name: string; attributes: Parameters<typeof serializeCookie>[2] }): string {
  return serializeCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 });
}
