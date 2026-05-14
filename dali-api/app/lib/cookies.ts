// Cookie helpers for the single session credential. See SESSION_AUTH_PLAN.md.

export const COOKIE_SID = "__dali_sid";

// 30 days in seconds — same horizon as ROLLING_TTL_MS in `lib/session.ts`,
// kept local so this module doesn't transitively import the Prisma client.
// The cookie Max-Age and the DB rolling TTL are independently enforced:
// the server is the source of truth, and an expired DB session 302s to
// /login on the next request regardless of the cookie's lifetime.
const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const isProduction = process.env.NODE_ENV === "production";

export function setSessionCookie(headers: Headers, rawSessionId: string) {
  const parts = [
    `${COOKIE_SID}=${rawSessionId}`,
    `Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isProduction) parts.push("Secure");
  headers.append("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(headers: Headers) {
  headers.append(
    "Set-Cookie",
    `${COOKIE_SID}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
  );
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") ?? "";
  const entries: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, ...rest] = part.split("=");
    if (k) entries[k.trim()] = rest.join("=").trim();
  }
  return entries;
}

export function parseSessionCookie(request: Request): string | null {
  return parseCookies(request)[COOKIE_SID] ?? null;
}

export function parseBearerHeader(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

// Cookie first, Bearer header second. Cookie wins if both present.
export function parseSessionId(request: Request): string | null {
  return parseSessionCookie(request) ?? parseBearerHeader(request);
}
