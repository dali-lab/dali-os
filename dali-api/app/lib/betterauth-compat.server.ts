// BetterAuth-substrate replacement for the session bits of ~/lib/auth.ts.
// Created in Phase 0 and NOT yet wired into routes. The type-derivation is
// identity/relationship-based and unchanged by the 3-way-door model: account
// type comes from which door the user used (member/dartmouth/partner), not
// from auto-classification of email domains.
//
// Phase 1 call-sites can swap `requireAuth` → `requireUser` and
// `auth.user` → `user` with minimal diffs.

import { auth } from "~/lib/betterauth.server";
import { isCore } from "~/lib/roles";

export type AuthUser = {
  sub: string;
  email: string;
  type: string;
  firstName?: string;
  lastName?: string;
};

// Derive the member/dartmouth/partner type. Extends today's deriveAuthType
// (~/lib/auth.ts) with one addition: a verified `dartmouthEmail` also counts as
// the "dartmouth" signal. The legacy CAS path always set netId alongside
// dartmouthEmail, so this is a no-op for existing users — but a NEW Dartmouth-
// door user whose netID lookup hasn't resolved yet (a miss, filled later at
// hiring) still types as "dartmouth" via the @dartmouth.edu address they
// verified, instead of falling through to "partner".
function deriveType(
  daliEmail: string | null | undefined,
  netId: string | null | undefined,
  dartmouthEmail: string | null | undefined,
): string {
  if (daliEmail) return "member";
  if (netId || dartmouthEmail) return "dartmouth";
  return "partner";
}

function unauthorizedJson(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function forbiddenJson(): Response {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

// BetterAuth's TypeScript definitions for additionalFields are incomplete —
// the runtime session.user object carries the fields declared in
// betterauth.server.ts (daliEmail, netId, dartmouthEmail, personalEmail,
// firstName, lastName) but the generated type does not reflect them yet. This
// narrow shape reads only those fields; it can be removed once typings improve.
type BetterAuthSessionUser = {
  id: string;
  email?: string | null;
  daliEmail?: string | null;
  netId?: string | null;
  dartmouthEmail?: string | null;
  personalEmail?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

// Map a BetterAuth session user to today's AuthUser shape. During the backfill
// window the canonical `email` column may be null for some rows, so fall back
// through the identity-specific addresses in precedence order.
function toAuthUser(user: BetterAuthSessionUser): AuthUser {
  const email =
    (user.email || user.daliEmail || user.dartmouthEmail || user.personalEmail) ?? "";
  return {
    sub: user.id,
    email,
    type: deriveType(user.daliEmail, user.netId, user.dartmouthEmail),
    firstName: user.firstName ?? undefined,
    lastName: user.lastName ?? undefined,
  };
}

// Read a BetterAuth session for the incoming request and map it to AuthUser.
// Returns null when there is no valid session.
export async function getBetterAuthUser(request: Request): Promise<AuthUser | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  return toAuthUser(session.user as BetterAuthSessionUser);
}

// Impersonation state for the current request. The BetterAuth admin plugin
// stamps the acting session row with `impersonatedBy` = the admin's user id
// when they "log in as" a member (see /admin/impersonate). Returns null for a
// normal session, no session, or when the field is absent — callers treat that
// as "not impersonating". The generated session type doesn't yet expose the
// admin-plugin column, hence the local narrowing.
export async function getImpersonationState(
  request: Request,
): Promise<{ impersonatedBy: string } | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  const impersonatedBy = (
    session?.session as { impersonatedBy?: string | null } | undefined
  )?.impersonatedBy;
  if (!impersonatedBy) return null;
  return { impersonatedBy };
}

// Coexistence entry point used by requireAuth (~/lib/auth.ts): returns both the
// AuthUser AND the BetterAuth session id (used where the legacy AuthSuccess
// exposed a hashed session id — the active-sessions UI, an analytics rate-limit
// key, layout telemetry). Returns null when there is no valid BetterAuth session.
export async function resolveBetterAuthAuth(
  request: Request,
): Promise<{ user: AuthUser; sessionId: string } | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  return {
    user: toAuthUser(session.user as BetterAuthSessionUser),
    sessionId: session.session.id,
  };
}

// Require a valid BetterAuth session. Returns { ok: true; user } or
// { ok: false; response } with a 401.
export async function requireUser(
  request: Request,
): Promise<{ ok: true; user: AuthUser } | { ok: false; response: Response }> {
  const user = await getBetterAuthUser(request);
  if (!user) return { ok: false, response: unauthorizedJson() };
  return { ok: true, user };
}

// Require a valid BetterAuth session AND Core membership. Returns
// { ok: true; user } or { ok: false; response } with a 401/403.
export async function requireCore(
  request: Request,
): Promise<{ ok: true; user: AuthUser } | { ok: false; response: Response }> {
  const result = await requireUser(request);
  if (!result.ok) return result;
  const core = await isCore(result.user.sub);
  if (!core) return { ok: false, response: forbiddenJson() };
  return { ok: true, user: result.user };
}
