import { redirect } from "react-router";
import {
  clearSessionCookie,
  parseSessionIdWithSource,
  looksLikeWellFormedSessionId,
} from "~/lib/cookies";
import { logAuditEvent } from "~/lib/audit";
import { lookupSession, rollSession, hashSessionId } from "~/lib/session";
import { withCors } from "~/lib/cors";
import { isCore, isDomainLead, isProjectMember } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { displayEmail } from "~/lib/display";
import { cachedForRequest } from "~/lib/request-cache";

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

export type AuthSuccess = {
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

function unauthorizedJson(): Response {
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
  personalEmail: string | null;
  netId: string | null;
  firstName: string;
  lastName: string;
}): AuthUser {
  return {
    sub: user.id,
    email: displayEmail(user),
    type: deriveAuthType(user),
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

// Memoized per request: the shell (layout.tsx) and the matched route loader
// both call requireAuth for the same navigation, so without this the session
// lookup (and its throttled roll/heartbeat writes) ran twice per page load.
export async function requireAuth(request: Request): Promise<AuthResult> {
  return cachedForRequest(request, "requireAuth", () => computeAuth(request));
}

async function computeAuth(request: Request): Promise<AuthResult> {
  const credential = parseSessionIdWithSource(request);
  if (!credential) {
    return { ok: false, response: unauthorizedJson(), reason: "no_session" };
  }

  const session = await lookupSession(credential.raw);
  if (!session) {
    // A stale browser cookie — well-formed but no longer in the DB — is the
    // expected outcome after session rotation, logout-in-another-tab, or the
    // 30-day rolling expiry. It generates one of these on every loader of
    // every page until the cookie is cleared, so logging it floods the audit
    // table with no security value. Filter to two cases worth keeping:
    //   - cookie present but malformed → potential probing, log it
    //   - bearer token miss → MCP client signal, log it (clients should refresh
    //     before presenting an expired token)
    const malformedCookie =
      credential.source === "cookie" &&
      !looksLikeWellFormedSessionId(credential.raw);
    if (credential.source === "bearer") {
      await logAuditEvent({ action: "auth.token.invalid", request });
    } else if (malformedCookie) {
      await logAuditEvent({ action: "auth.token.malformed", request });
    }
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
  rollSession(session).catch(() => {});
  bumpLastActive(session.user.id).catch(() => {});

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

export function unauthorized(request: Request): Response {
  return withCors(request, Response.json({ error: "Unauthorized" }, { status: 401 }));
}

export function forbidden(request: Request): Response {
  return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
}

export async function requireCore(
  request: Request,
): Promise<{ ok: true; auth: AuthSuccess } | { ok: false; response: Response }> {
  const auth = await requireAuth(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  const core = await isCore(auth.user.sub);
  if (!core) return { ok: false, response: forbidden(request) };
  return { ok: true, auth };
}

export async function requireCoreOrDomainLead(
  request: Request,
): Promise<{ ok: true; auth: AuthSuccess } | { ok: false; response: Response }> {
  const auth = await requireAuth(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  const [core, domainLead] = await Promise.all([
    isCore(auth.user.sub),
    isDomainLead(auth.user.sub),
  ]);
  if (!core && !domainLead) return { ok: false, response: forbidden(request) };
  return { ok: true, auth };
}

export async function requireMemberSession(
  request: Request,
): Promise<{ ok: true; auth: AuthSuccess } | { ok: false; response: Response }> {
  const auth = await requireAuth(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  const member = await prisma.dALIMember.findUnique({
    where: { userId: auth.user.sub },
  });
  if (!member) {
    return {
      ok: false,
      response: withCors(
        request,
        Response.json({ error: "Not a DALI member" }, { status: 403 }),
      ),
    };
  }
  return { ok: true, auth };
}

// Matches the loader's canEdit predicate at projects.$id.tsx — Core OR
// a current/historical assignee of the project may edit project content
// (tasks, epics, stories, sprints, documents, files).
export async function requireProjectEditAccess(
  request: Request,
  projectId: string,
): Promise<{ ok: true; auth: AuthSuccess } | { ok: false; response: Response }> {
  const auth = await requireAuth(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  const [core, member] = await Promise.all([
    isCore(auth.user.sub),
    isProjectMember(auth.user.sub, projectId),
  ]);
  if (!core && !member) return { ok: false, response: forbidden(request) };
  return { ok: true, auth };
}

export function redirectApplicantToPortal(auth: AuthSuccess): Response | null {
  if (auth.user.type === "applicant") return redirect("/portal");
  return null;
}

// Partner accounts belong in /partner, not the member shell or applicant
// portal. Type "partner" alone is a residual bucket (no daliEmail, no netId)
// that also holds members mid-Workspace-provisioning, so the gate keys off
// the PartnerContact row. Cheap for everyone else: no query unless the type
// matches. Prisma is lazy-imported so tests mocking only ~/lib/auth's
// consumers don't need a db mock (same pattern as lib/audit.ts).
export async function isPartnerAccount(auth: AuthSuccess): Promise<boolean> {
  if (auth.user.type !== "partner") return false;
  const { prisma } = await import("~/lib/db");
  const contact = await prisma.partnerContact.findUnique({
    where: { userId: auth.user.sub },
    select: { id: true },
  });
  return contact !== null;
}

export async function redirectPartnerToPortal(
  auth: AuthSuccess,
): Promise<Response | null> {
  return (await isPartnerAccount(auth)) ? redirect("/partner") : null;
}

// Throttled presence heartbeat. Mirrors rollSession's throttle pattern:
// a conditional UPDATE so the write is a no-op when the row is already fresh.
// The 60s guard keeps concurrent Neon connections from hammering the same row
// on every loader call while the user navigates quickly between pages.
export async function bumpLastActive(userId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "User"
    SET "lastActiveAt" = now()
    WHERE id = ${userId}
      AND ("lastActiveAt" IS NULL OR "lastActiveAt" < now() - interval '60 seconds')
  `;
}
