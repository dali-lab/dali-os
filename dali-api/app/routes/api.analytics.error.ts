import type { Route } from "./+types/api.analytics.error";
import { z } from "zod";
import { requireAuth } from "~/lib/auth";
import { checkRateLimit } from "~/lib/rate-limit";
import { recordClientError, normalizePath } from "~/lib/analytics";

// Beacon endpoint for uncaught client errors. Posted from root.tsx's
// ErrorBoundary and window error/unhandledrejection listeners via
// navigator.sendBeacon (fire-and-forget; the browser keeps the request alive
// across page unloads).
//
// Auth-required so we don't accept anonymous noise. Strict rate limit per
// session keeps a render loop from flooding the table.

const ErrorSchema = z.object({
  message: z.string().min(1).max(1_000),
  path: z.string().min(1).max(500),
  stack: z.string().max(10_000).optional(),
  release: z.string().max(100).optional(),
});

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  // 20 errors per session per minute. A buggy render shouldn't be able to
  // generate more than this before the user navigates away.
  const limited = checkRateLimit(
    request,
    { max: 20, windowMs: 60_000 },
    `client_error:${auth.sessionId}`,
  );
  if (limited) return limited;

  let parsed;
  try {
    parsed = ErrorSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  await recordClientError({
    userId: auth.user.sub,
    path: normalizePath(parsed.path),
    message: parsed.message,
    stack: parsed.stack ?? null,
    userAgent: request.headers.get("User-Agent"),
    release: parsed.release ?? null,
  });

  return new Response(null, { status: 204 });
}
