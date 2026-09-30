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
  // The acting admin's user id when this session was started by an admin's
  // "log in as" (BetterAuth admin plugin stamps AuthSession.impersonatedBy).
  // Undefined for a normal session. Everything downstream reads `user` as the
  // impersonated member, so this is the ONLY signal a route has that it is
  // serving an admin wearing someone else's identity — see isImpersonating.
  impersonatedBy?: string;
};

type AuthFailureReason =
  | "no_session"
  | "not_found"
  | "revoked"
  | "expired"
  // A mutating request on an impersonated session. The credential is valid; the
  // session just isn't allowed to write. See requireAuth.
  | "impersonated_write";

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

// Methods that cannot mutate. Everything else counts as a write.
function isReadOnlyMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

// Memoized per request: the shell (layout.tsx) and the matched route loader
// both call requireAuth for the same navigation, so without this the session
// lookup (and its throttled roll/heartbeat writes) ran twice per page load.
//
// Impersonation is read-only. Rather than gating 250-odd action modules one by
// one (and missing every route added later), every mutating request on an
// impersonated session is refused here, at the one entry point they all share,
// so the default for new code is deny. An admin can see what a member sees;
// they cannot act as them — no signing an agreement, sending their mail,
// writing to their Google Calendar, submitting a form or logging hours as them.
//
// `allowImpersonatedWrite` is for the handful of endpoints that POST in order to
// READ (a request body too big or too structured for a query string, e.g.
// /api/calendar/group-availability). Pass it only when the handler cannot
// mutate; over-blocking a genuine read shows up as a 403 in an admin's
// impersonated session, which is recoverable, while under-blocking a write is
// the bug this exists to prevent.
//
// Exiting impersonation is deliberately NOT routed through here:
// /admin/stop-impersonating resolves its own session via getBetterAuthUser, so
// this block can never trap an admin inside a session they can't leave.
export async function requireAuth(
  request: Request,
  opts?: { allowImpersonatedWrite?: boolean },
): Promise<AuthResult> {
  // Resolve (and cache) identity first, independent of the write gate, so a
  // caller passing allowImpersonatedWrite can't poison the memoized result for
  // another caller on the same request.
  const result = await cachedForRequest(request, "requireAuth", () => computeAuth(request));
  if (!result.ok || isReadOnlyMethod(request.method)) return result;
  if (opts?.allowImpersonatedWrite || !isImpersonating(result)) return result;
  return {
    ok: false,
    response: withCors(
      request,
      Response.json(
        { error: "Impersonation is read-only", reason: "impersonating" },
        { status: 403 },
      ),
    ),
    reason: "impersonated_write",
  };
}

// Resolve auth for a request. Tries the legacy DB-backed session first; if that
// fails AND the global `betterauth` switch is on (Phase 1 coexistence / cutover),
// accepts a BetterAuth session instead. Flag off (the default) → byte-for-byte
// the legacy behavior. The BetterAuth path is lazy-imported so its module graph
// (and the auth instance) stays out of requests — and unit tests — while the
// flag is off, and wrapped so a fault there can't break the already-failed
// legacy path.
async function computeAuth(request: Request): Promise<AuthResult> {
  const legacy = await computeLegacyAuth(request);
  if (legacy.ok) return legacy;
  try {
    const { isFeatureEnabledForEveryone } = await import("~/lib/feature-flags.server");
    if (await isFeatureEnabledForEveryone("betterauth", request)) {
      const { resolveBetterAuthAuth } = await import("~/lib/betterauth-compat.server");
      const ba = await resolveBetterAuthAuth(request);
      if (ba)
        return {
          ok: true,
          user: ba.user,
          sessionId: ba.sessionId,
          ...(ba.impersonatedBy ? { impersonatedBy: ba.impersonatedBy } : {}),
        };
    }
  } catch {
    // The BetterAuth fallback must never turn a clean legacy failure into a 500.
  }
  // Both backends rejected the request. Only NOW — after the BetterAuth fallback
  // has also failed — record a credential that never resolved. Logging this in
  // computeLegacyAuth (the legacy leg) instead fired an auth.token.invalid on
  // EVERY successful BetterAuth *bearer* request: a BetterAuth token is never a
  // legacy session id, so it always misses lookupSession first. Post-cutover
  // that flooded the audit log from desktop notification polling and MCP.
  if (legacy.reason === "not_found") await logCredentialMiss(request);
  return legacy;
}

// Emit the credential-miss audit signal for a request whose credential resolved
// to no session on any backend. A bearer miss is a real "client should refresh"
// signal (MCP); a malformed cookie is worth flagging as possible probing. A
// well-formed cookie that simply isn't in the DB is the benign post-rotation /
// logout / expiry case and is deliberately NOT logged — it would fire on every
// loader of every page until the stale cookie clears.
async function logCredentialMiss(request: Request): Promise<void> {
  const credential = parseSessionIdWithSource(request);
  if (!credential) return;
  if (credential.source === "bearer") {
    await logAuditEvent({ action: "auth.token.invalid", request });
  } else if (!looksLikeWellFormedSessionId(credential.raw)) {
    await logAuditEvent({ action: "auth.token.malformed", request });
  }
}

async function computeLegacyAuth(request: Request): Promise<AuthResult> {
  const credential = parseSessionIdWithSource(request);
  if (!credential) {
    return { ok: false, response: unauthorizedJson(), reason: "no_session" };
  }

  const session = await lookupSession(credential.raw);
  if (!session) {
    // Credential present but no legacy session. The audit signal for this is
    // emitted by the caller (computeAuth), AFTER the BetterAuth fallback also
    // fails — so a BetterAuth bearer that misses the legacy table here but then
    // validates via getSession never logs a false auth.token.invalid.
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

// CAS serializes names with XML/HTML entities — Dartmouth emits an apostrophe as
// the numeric reference "&#39;", so "O'Neill" arrives as "O&#39;Neill". The name
// regex captures that literal text verbatim; decode it before storing or the
// entity string is what shows up (e.g. the audit log rendered "Liam O&#39;Neill").
// Handles numeric (decimal + hex, so accented letters survive too) and the named
// XML entities. &amp; is decoded LAST so an escaped "&amp;#39;" resolves to
// "&#39;", not "'".
function decodeCasEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

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
  const fullName = decodeCasEntities(nameMatch?.[1] ?? "").trim();

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

// An admin impersonating a member gets that member's identity everywhere, which
// is what makes impersonation useful for support (roles, nav, tasks, what a
// page looks like to them) and what makes it wrong for the member's private
// content: their Google Calendar event bodies, their mail, their personal
// notes and Drive space. Those surfaces check this and hide the content instead
// of serving it — impersonation is for reproducing what someone can DO, not for
// reading what they wrote.
export function isImpersonating(auth: AuthSuccess): boolean {
  return auth.impersonatedBy != null;
}

// 403 for a personal-data endpoint that has no meaningful degraded shape (an
// API that exists only to return private content). Page loaders that can still
// render something useful branch on isImpersonating instead and pass a flag to
// the UI.
export function forbiddenWhileImpersonating(request: Request): Response {
  return withCors(
    request,
    Response.json(
      { error: "Hidden while impersonating", reason: "impersonating" },
      { status: 403 },
    ),
  );
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
