// Extract a client IP from a request. Fly forwards via `Fly-Client-IP`;
// fall back to the leftmost `X-Forwarded-For` entry. Returns undefined
// when nothing is available (e.g., direct local connection in tests).

export function getClientIp(request: Request): string | undefined {
  const fly = request.headers.get("fly-client-ip");
  if (fly) return fly.trim();
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return undefined;
}
