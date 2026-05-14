// Cookie helpers for the single session credential. See SESSION_AUTH_PLAN.md.

import { ROLLING_TTL_MS } from "~/lib/session";

export const COOKIE_SID = "__dali_sid";

const isProduction = process.env.NODE_ENV === "production";

export function setSessionCookie(headers: Headers, rawSessionId: string) {
  const parts = [
    `${COOKIE_SID}=${rawSessionId}`,
    `Max-Age=${Math.floor(ROLLING_TTL_MS / 1000)}`,
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
