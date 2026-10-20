import type { Route } from "./+types/api.analytics.pageview";
import { z } from "zod";
import { requireAuth } from "~/lib/auth";
import { checkRateLimit } from "~/lib/rate-limit";
import { recordPageView, recordPageDuration } from "~/lib/analytics";

const PageViewBeaconSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("view"),
    id: z.string().uuid(),
    path: z.string().min(1).max(500),
    referrer: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal("duration"),
    id: z.string().uuid(),
    durationMs: z.number().int().min(0),
  }),
]);

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const limited = checkRateLimit(
    request,
    { max: 120, windowMs: 60_000 },
    `pageview:${auth.sessionId}`,
  );
  if (limited) return limited;

  let body;
  try {
    body = PageViewBeaconSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  if (body.type === "view") {
    await recordPageView({
      id: body.id,
      userId: auth.user.sub,
      sessionId: auth.sessionId,
      path: body.path,
      referrer: body.referrer ?? null,
      userAgent: request.headers.get("User-Agent"),
    });
  } else {
    await recordPageDuration({
      id: body.id,
      userId: auth.user.sub,
      durationMs: body.durationMs,
    });
  }

  return new Response(null, { status: 204 });
}
