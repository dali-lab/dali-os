// Site analytics helpers. Distinct from lib/audit.ts:
//   - AuditLog = accountability ("who did what to whom"). Retained forever.
//   - Analytics = product usage / health ("is it working, is anyone using it").
//     Bounded retention; never stores PII beyond a userId.
//
// Pageviews are written from the app shell loader (routes/layout.tsx) on every
// authenticated UI navigation. Errors are written from a beacon endpoint
// posted by the client error boundary + window listeners.

// Normalize raw paths to route patterns so the dashboard can group hits.
// We don't have a runtime route-manifest lookup, so we collapse the segments
// most likely to be ids (cuids and uuids). This keeps the cardinality of
// `path` bounded at ~30 patterns rather than ballooning per-row.
const CUID_RE = /^c[a-z0-9]{20,}$/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^\d+$/;

export function normalizePath(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      if (CUID_RE.test(seg) || UUID_RE.test(seg) || NUMERIC_RE.test(seg)) {
        return ":id";
      }
      return seg;
    })
    .join("/");
}

const TRACKED_PREFIXES = [
  "/hiring",
  "/projects",
  "/members",
  "/partners",
  "/education",
  "/forms",
  "/admin",
  "/core",
  "/drive",
  "/internal-processes",
  "/calendar",
  "/profile",
  "/portal",
];

// Decide whether a path is worth a pageview row. Skips API/auth/asset noise.
export function shouldTrackPath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/oauth/") ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/dev-login") ||
    pathname === "/login" ||
    pathname === "/logout"
  ) {
    return false;
  }
  return TRACKED_PREFIXES.some((p) => pathname.startsWith(p));
}

type RecordPageViewInput = {
  request: Request;
  userId: string | null;
  sessionId: string; // hashed session PK, opaque to clients
};

export function recordPageView({
  request,
  userId,
  sessionId,
}: RecordPageViewInput): void {
  const url = new URL(request.url);
  if (!shouldTrackPath(url.pathname)) return;

  const path = normalizePath(url.pathname);
  const referrer = request.headers.get("Referer");

  // Detached so a write failure or DB slowness never blocks the response.
  void (async () => {
    try {
      const { prisma } = await import("~/lib/db");
      await prisma.pageView.create({
        data: {
          userId,
          sessionId,
          path,
          referrer: referrer ?? null,
        },
      });
    } catch (err) {
      console.error("pageview write failed", {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}

type RecordClientErrorInput = {
  userId: string | null;
  path: string;
  message: string;
  stack?: string | null;
  userAgent?: string | null;
  release?: string | null;
};

export async function recordClientError(
  input: RecordClientErrorInput,
): Promise<void> {
  try {
    const { prisma } = await import("~/lib/db");
    await prisma.clientError.create({
      data: {
        userId: input.userId,
        // Path is already normalized on the client; defend with a length cap.
        path: input.path.slice(0, 500),
        message: input.message.slice(0, 1_000),
        stack: input.stack ? input.stack.slice(0, 10_000) : null,
        userAgent: input.userAgent ? input.userAgent.slice(0, 500) : null,
        release: input.release ? input.release.slice(0, 100) : null,
      },
    });
  } catch (err) {
    console.error("client error write failed", {
      message: input.message.slice(0, 200),
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
