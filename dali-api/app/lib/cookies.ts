// cookie helpers for httpOnly authentication tokens

const COOKIE_AT = "__dali_at";
const COOKIE_RT = "__dali_rt";

const isProduction = process.env.NODE_ENV === "production";

function setCookie(
  headers: Headers,
  name: string,
  value: string,
  maxAge: number,
  path = "/",
) {
  const parts = [
    `${name}=${value}`,
    `Max-Age=${maxAge}`,
    `Path=${path}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isProduction) parts.push("Secure");
  headers.append("Set-Cookie", parts.join("; "));
}

export function setTokenCookies(
  headers: Headers,
  accessToken: string,
  refreshToken: string,
) {
  setCookie(headers, COOKIE_AT, accessToken, 900);
  // RT path is `/` so it is sent to every request — required for the silent
  // refresh in `requireAuth`. Theft defence is the family-revocation reuse
  // detection in `refreshTokens`, plus HttpOnly + SameSite=Lax + Secure-in-prod.
  setCookie(headers, COOKIE_RT, refreshToken, 604800);
}

export function clearTokenCookies(headers: Headers) {
  headers.append(
    "Set-Cookie",
    `${COOKIE_AT}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
  );
  headers.append(
    "Set-Cookie",
    `${COOKIE_RT}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
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

export function parseAccessToken(request: Request): string | null {
  return parseCookies(request)[COOKIE_AT] ?? null;
}

export function parseRefreshToken(request: Request): string | null {
  return parseCookies(request)[COOKIE_RT] ?? null;
}
