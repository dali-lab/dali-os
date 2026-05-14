import { clearSessionCookie, parseSessionId } from "~/lib/cookies";
import { logAuditEvent } from "~/lib/audit";
import { lookupSession, rollSession, hashSessionId } from "~/lib/session";

// Session-backed auth middleware. See SESSION_AUTH_PLAN.md for design.
// The `user.sub` shape is preserved from the legacy JWT payload so existing
// callers (`auth.user.sub` is used across calendar/, collab/, etc.) keep
// working without per-file edits.

export type AuthUser = {
  sub: string;
  email: string;
  type: string;
  firstName?: string;
  lastName?: string;
};

type AuthSuccess = {
  ok: true;
  user: AuthUser;
  sessionId: string; // hashed PK; not the raw credential
};

type AuthFailureReason =
  | "no_session"
  | "not_found"
  | "revoked"
  | "expired";

type AuthFailure = {
  ok: false;
  response: Response;
  reason: AuthFailureReason;
};

export type AuthResult = AuthSuccess | AuthFailure;

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function unauthorizedClearingCookies(): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  clearSessionCookie(headers);
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers,
  });
}

function deriveAuthType(user: {
  daliEmail: string | null;
  netId: string | null;
}): string {
  if (user.daliEmail) return "member";
  if (user.netId) return "dartmouth";
  return "partner";
}

function buildAuthUser(user: {
  id: string;
  daliEmail: string | null;
  dartmouthEmail: string | null;
  netId: string | null;
  firstName: string;
  lastName: string;
}): AuthUser {
  return {
    sub: user.id,
    email:
      user.daliEmail ?? user.dartmouthEmail ?? `${user.netId}@dartmouth.edu`,
    type: deriveAuthType(user),
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

export async function requireAuth(request: Request): Promise<AuthResult> {
  const raw = parseSessionId(request);
  if (!raw) {
    return { ok: false, response: unauthorized(), reason: "no_session" };
  }

  const session = await lookupSession(raw);
  if (!session) {
    await logAuditEvent({ action: "auth.token.invalid", request });
    return { ok: false, response: unauthorizedClearingCookies(), reason: "not_found" };
  }

  if (session.revokedAt) {
    return { ok: false, response: unauthorizedClearingCookies(), reason: "revoked" };
  }

  const now = new Date();
  if (session.expiresAt < now || session.absoluteExpiresAt < now) {
    return { ok: false, response: unauthorizedClearingCookies(), reason: "expired" };
  }

  // Fire-and-forget — a failed roll doesn't break the request.
  rollSession(session.id).catch(() => {});

  return {
    ok: true,
    user: buildAuthUser(session.user),
    sessionId: session.id,
  };
}

// Convenience used by routes that need to surface the hashed session id
// without going through the full auth flow.
export function sessionIdHash(raw: string): string {
  return hashSessionId(raw);
}

// dartmouth cas (sso) ticket validation — unrelated to session auth

export async function validateCasTicket(ticket: string, serviceUrl: string) {
  const casBase = process.env.CAS_BASE_URL ?? "https://login.dartmouth.edu/cas";
  const url = `${casBase}/serviceValidate?ticket=${encodeURIComponent(ticket)}&service=${encodeURIComponent(serviceUrl)}`;

  const res = await fetch(url);
  const xml = await res.text();

  const userMatch = xml.match(/<cas:user>([^<]+)<\/cas:user>/);
  if (!userMatch) throw new Error("CAS authentication failed");

  const netIdMatch = xml.match(/<cas:netid>([^<]+)<\/cas:netid>/);
  const nameMatch = xml.match(/<cas:name>([^<]+)<\/cas:name>/);

  const netId = netIdMatch?.[1] ?? userMatch[1].trim();
  const fullName = nameMatch?.[1]?.trim() ?? "";

  const nameParts = fullName.split(" ");
  const firstName = nameParts[0] || netId;
  const lastName = nameParts.length > 1 ? nameParts.slice(-1)[0] : "";

  return { netId, firstName, lastName };
}
