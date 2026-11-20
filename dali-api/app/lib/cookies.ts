const LEGACY_SESSION_COOKIE = "__dali_sid";

export function clearSessionCookie(headers: Headers) {
  headers.append(
    "Set-Cookie",
    `${LEGACY_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
  );
}

export function parseBearerHeader(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}
