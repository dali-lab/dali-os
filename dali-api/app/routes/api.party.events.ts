// POST /api/party/events
// Records a launch-party telemetry event. Auth-gated (matches the /party
// loader). Server fills userId/audience/createdAt — clients can only supply
// the event type and optional metadata.

import { requireAuth, withAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { safeJson } from "~/lib/safe-json";

const EVENT_TYPES = [
  "PARTY_VISIT",
  "CODE_UNLOCK_SUCCESS",
  "CODE_UNLOCK_FAILURE",
  "DINO_REWARD_EARNED",
  "LOGO_TRAIL_TRIGGERED",
] as const;

type PartyEventType = (typeof EVENT_TYPES)[number];

const VISIT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const PARTY_BODY_MAX_BYTES = 4_096;

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const parsed = await safeJson<{
    eventType?: unknown;
    metadata?: unknown;
  }>(request, PARTY_BODY_MAX_BYTES);
  if (parsed instanceof Response) return withAuth(auth, parsed);

  const eventType = parsed.eventType;
  if (typeof eventType !== "string" || !EVENT_TYPES.includes(eventType as PartyEventType)) {
    return withAuth(auth, Response.json({ error: "Invalid eventType" }, { status: 400 }));
  }

  const audience = auth.user.type === "member" ? "member" : "applicant";

  const metadata =
    parsed.metadata && typeof parsed.metadata === "object" && !Array.isArray(parsed.metadata)
      ? (parsed.metadata as Record<string, unknown>)
      : undefined;

  // Dedup PARTY_VISIT per user per 24h. Refresh-spam shouldn't skew counts.
  // Other event types stay un-deduped — repeated unlock failures are funnel
  // signal, dino rewards already self-cap on the client, and the logo trail
  // only fires once per redirect.
  if (eventType === "PARTY_VISIT") {
    const since = new Date(Date.now() - VISIT_DEDUP_WINDOW_MS);
    const existing = await prisma.partyEvent.findFirst({
      where: {
        userId: auth.user.sub,
        eventType: "PARTY_VISIT",
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (existing) return withAuth(auth, Response.json({ ok: true, deduped: true }));
  }

  await prisma.partyEvent.create({
    data: {
      userId: auth.user.sub,
      audience,
      eventType: eventType as PartyEventType,
      metadata: metadata as never,
    },
  });

  return withAuth(auth, Response.json({ ok: true }));
}
