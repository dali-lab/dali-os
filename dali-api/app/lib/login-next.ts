// Post-login return path. OAuth round-trips can't keep a ?next= query param, so
// login stores a safe relative path in a short-lived cookie that auth callbacks
// consume when landing the user.

import { redirect } from "react-router";
import { getAppEnv } from "./app-env";

export const LOGIN_NEXT_COOKIE = "__dali_login_next";
const LOGIN_NEXT_MAX_AGE = 600; // 10 minutes — matches oauth state cookie TTL

/** Same-origin relative paths only — blocks open redirects. */
export function isSafeLoginNext(next: string | null | undefined): next is string {
  if (!next) return false;
  return next.startsWith("/") && !next.startsWith("//");
}

export function pickSafeLoginNext(
  raw: string | null | undefined,
): string | null {
  return isSafeLoginNext(raw) ? raw : null;
}

/** Redirect unauthenticated visitors to /login, preserving the current URL. */
export function redirectToLogin(request: Request): Response {
  const url = new URL(request.url);
  const next = `${url.pathname}${url.search}`;
  const target = isSafeLoginNext(next)
    ? `/login?next=${encodeURIComponent(next)}`
    : "/login";
  return redirect(target);
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

export function readLoginNextCookie(request: Request): string | null {
  const raw = parseCookies(request)[LOGIN_NEXT_COOKIE];
  if (!raw) return null;
  try {
    return pickSafeLoginNext(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

export function setLoginNextCookie(headers: Headers, next: string): void {
  if (!isSafeLoginNext(next)) return;
  const parts = [
    `${LOGIN_NEXT_COOKIE}=${encodeURIComponent(next)}`,
    `Max-Age=${LOGIN_NEXT_MAX_AGE}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (getAppEnv() !== "dev") parts.push("Secure");
  headers.append("Set-Cookie", parts.join("; "));
}

export function clearLoginNextCookie(headers: Headers): void {
  headers.append(
    "Set-Cookie",
    `${LOGIN_NEXT_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
  );
}

/**
 * Read a safe next from the cookie and clear it. Use on final auth landings
 * (not when chaining Google → CAS link — leave the cookie for the final hop).
 */
export function consumeLoginNext(
  request: Request,
  headers: Headers,
): string | null {
  const next = readLoginNextCookie(request);
  clearLoginNextCookie(headers);
  return next;
}
