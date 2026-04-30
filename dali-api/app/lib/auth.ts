import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { data } from "react-router";
import {
  parseAccessToken,
  parseRefreshToken,
  setTokenCookies,
  clearTokenCookies,
} from "~/lib/cookies";
import { logAuditEvent } from "~/lib/audit";
import { refreshTokens } from "~/lib/oauth";

// jwt helper functions

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  const encoded = new TextEncoder().encode(secret);
  if (encoded.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 bytes for HS256 security");
  }
  return encoded;
}

export async function signAccessToken(payload: {
  sub: string;
  email: string;
  type: string;
  firstName?: string;
  lastName?: string;
}) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getSecret());
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, getSecret());
  return payload as {
    sub: string;
    email: string;
    type: string;
    firstName?: string;
    lastName?: string;
  };
}

// auth middleware

type AuthUser = {
  sub: string;
  email: string;
  type: string;
  firstName?: string;
  lastName?: string;
};
type AuthSuccess = {
  ok: true;
  user: AuthUser;
  // Set-Cookie strings to attach to the outgoing response, set when
  // requireAuth performed a silent refresh. Use `withAuth(auth, response)` to
  // forward them to the browser.
  setCookies?: string[];
};
type AuthFailure = { ok: false; response: Response };
export type AuthResult = AuthSuccess | AuthFailure;

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function unauthorizedClearingCookies(): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  clearTokenCookies(headers);
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers,
  });
}

// Per-request de-dup so two parallel loaders don't both burn a single RT.
// The first call rotates the RT; the second awaits the same in-flight promise
// and reuses its newly-issued tokens, instead of presenting the now-revoked RT
// and tripping reuse detection.
type RefreshOutcome =
  | { ok: true; user: AuthUser; setCookies: string[] }
  | { ok: false };
const inFlightRefreshes = new Map<string, Promise<RefreshOutcome>>();

async function performRefresh(rawRT: string): Promise<RefreshOutcome> {
  const existing = inFlightRefreshes.get(rawRT);
  if (existing) return existing;

  const promise = (async (): Promise<RefreshOutcome> => {
    try {
      const refreshed = await refreshTokens(rawRT);
      const headers = new Headers();
      setTokenCookies(headers, refreshed.access_token, refreshed.refresh_token);
      return {
        ok: true,
        user: {
          sub: refreshed.userInfo.id,
          email: refreshed.userInfo.email,
          type: refreshed.userInfo.type,
          firstName: refreshed.userInfo.firstName,
          lastName: refreshed.userInfo.lastName,
        },
        setCookies: headers.getSetCookie(),
      };
    } catch {
      return { ok: false };
    }
  })();

  inFlightRefreshes.set(rawRT, promise);
  try {
    return await promise;
  } finally {
    inFlightRefreshes.delete(rawRT);
  }
}

export async function requireAuth(request: Request): Promise<AuthResult> {
  // try cookie first, fall back to authorization header if not present
  let token = parseAccessToken(request);

  // don't strictly need this yet but good to have support if we want to support API access later
  if (!token) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }
  }

  if (token) {
    try {
      const user = await verifyAccessToken(token);
      return { ok: true, user };
    } catch (e) {
      if (!(e instanceof joseErrors.JWTExpired)) {
        // Tampered or otherwise malformed AT — don't try to refresh.
        await logAuditEvent({
          action: "auth.token.invalid",
          request,
        });
        return { ok: false, response: unauthorized() };
      }
      // AT is just expired — fall through to silent refresh.
    }
  }

  // Silent refresh: trade a valid RT for a fresh AT/RT pair without bouncing
  // the user to /login. Bearer-token API callers (no RT cookie) still 401.
  const rawRT = parseRefreshToken(request);
  if (!rawRT) {
    return { ok: false, response: unauthorized() };
  }

  const outcome = await performRefresh(rawRT);
  if (outcome.ok) {
    return { ok: true, user: outcome.user, setCookies: outcome.setCookies };
  }

  // Refresh failed — RT is invalid, expired, revoked, or its family was
  // revoked due to reuse. Clear cookies so the browser stops resending them.
  return { ok: false, response: unauthorizedClearingCookies() };
}

// Forward Set-Cookie headers from `requireAuth` (silent refresh on success,
// cleared cookies after a failed refresh) onto the outgoing response. No-op
// when there are no cookies to forward, so it's safe to wrap unconditionally.
export function withAuth<T>(auth: AuthResult, value: T): T;
export function withAuth(auth: AuthResult, value: Response): Response;
export function withAuth(auth: AuthResult, value: unknown): unknown {
  const cookies = auth.ok
    ? auth.setCookies
    : auth.response.headers.getSetCookie();
  if (!cookies || cookies.length === 0) return value;

  if (value instanceof Response) {
    for (const c of cookies) value.headers.append("Set-Cookie", c);
    return value;
  }

  const headers = new Headers();
  for (const c of cookies) headers.append("Set-Cookie", c);
  return data(value, { headers });
}

// dartmouth cas (sso) ticket validation

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
