// Site analytics helpers. Distinct from lib/audit.ts:
//   - AuditLog = accountability ("who did what to whom"). Retained forever.
//   - Analytics = product usage / health ("is it working, is anyone using it").
//     Bounded retention; never stores PII beyond a userId.
//
// Pageviews and their time on page are written from a beacon endpoint posted
// by PageViewReporter (client-side navigations never re-run the layout
// loader). Errors are written from a beacon endpoint posted by the client
// error boundary + window listeners.

// No runtime route-manifest lookup exists, so id-like segments are collapsed
// to keep `path` cardinality bounded.
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

const UNTRACKED_ROOTS = [
  "/api",
  "/auth",
  "/oauth",
  "/.well-known",
  "/dev-login",
  "/login",
  "/logout",
  "/mcp",
  "/public-api",
  "/assets",
  "/build",
  "/internal",
];
const FILE_EXTENSION_RE = /\.[A-Za-z0-9]+$/;

export type PageViewClient = "web" | "desktop" | "mobile";

export const MAX_DURATION_MS = 30 * 60 * 1000;

export function shouldTrackPath(pathname: string): boolean {
  if (
    UNTRACKED_ROOTS.some((r) => pathname === r || pathname.startsWith(`${r}/`))
  ) {
    return false;
  }
  const last = pathname.split("/").pop() ?? "";
  return !FILE_EXTENSION_RE.test(last);
}

export function classifyClient(userAgent: string | null): PageViewClient {
  if (!userAgent) return "web";
  if (/DALI OS Desktop/i.test(userAgent)) return "desktop";
  if (/iPhone|iPad|iPod|Android|Mobi/i.test(userAgent)) return "mobile";
  return "web";
}

type RecordPageViewInput = {
  id: string;
  userId: string;
  sessionId: string;
  path: string;
  referrer?: string | null;
  userAgent: string | null;
};

export async function recordPageView(
  input: RecordPageViewInput,
): Promise<void> {
  if (!shouldTrackPath(input.path)) return;
  try {
    const { prisma } = await import("~/lib/db.server");
    await prisma.pageView.create({
      data: {
        id: input.id,
        userId: input.userId,
        sessionId: input.sessionId,
        path: normalizePath(input.path),
        referrer: input.referrer ?? null,
        client: classifyClient(input.userAgent),
      },
    });
  } catch (err) {
    if ((err as { code?: string } | null)?.code === "P2002") return;
    console.error("pageview write failed", {
      path: input.path,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function recordPageDuration(input: {
  id: string;
  userId: string;
  durationMs: number;
}): Promise<void> {
  const durationMs = Math.min(
    MAX_DURATION_MS,
    Math.max(0, Math.round(input.durationMs)),
  );
  try {
    const { prisma } = await import("~/lib/db.server");
    await prisma.pageView.updateMany({
      where: { id: input.id, userId: input.userId },
      data: { durationMs },
    });
  } catch (err) {
    console.error("pageview duration write failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
    const { prisma } = await import("~/lib/db.server");
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
