import type { Route } from "./+types/api.intent-to-work";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { requireMember } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

// POST /api/projects/intent-to-work
//
// A lab member declares, for the current staffing cycle, whether they'll be
// around each term in the cycle's upcoming year. Body:
//   { cycleId, entries: [{ termId, status, notes? }, ...] }
//
// Self-only: the row is always keyed to the authenticated user. Members
// revise by resubmitting — we upsert on the (user, cycle, term) unique.
// Staffing has no open/close lifecycle (one cycle per term, always open), so
// there's no status gate here; the page resolves/creates the cycle.

const STATUSES = ["Returning", "Off", "Graduating", "Leave", "Unsure"] as const;
type IntentStatus = (typeof STATUSES)[number];

type Entry = { termId: string; status: IntentStatus; notes?: string };
type Body = { cycleId: string; entries: Entry[] };

function isStatus(x: unknown): x is IntentStatus {
  return typeof x === "string" && (STATUSES as readonly string[]).includes(x);
}

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.cycleId !== "string") return false;
  if (!Array.isArray(o.entries) || o.entries.length === 0) return false;
  return o.entries.every((e) => {
    if (!e || typeof e !== "object") return false;
    const r = e as Record<string, unknown>;
    if (typeof r.termId !== "string") return false;
    if (!isStatus(r.status)) return false;
    if (r.notes !== undefined && typeof r.notes !== "string") return false;
    return true;
  });
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  // Self-service, but only hired lab members have an intent to declare.
  const member = await requireMember(auth.user.sub);
  if (!member) {
    return withCors(request, Response.json({ error: "Lab members only" }, { status: 403 }));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  const cycle = await prisma.staffingCycle.findUnique({
    where: { id: body.cycleId },
    select: { id: true },
  });
  if (!cycle) {
    return withCors(request, Response.json({ error: "Cycle not found" }, { status: 404 }));
  }

  // Reject duplicate terms and term IDs that don't exist, so a malformed
  // client can't half-write the set.
  const termIds = body.entries.map((e) => e.termId);
  if (new Set(termIds).size !== termIds.length) {
    return withCors(request, Response.json({ error: "Duplicate term in submission" }, { status: 400 }));
  }
  const knownTerms = await prisma.term.findMany({
    where: { id: { in: termIds } },
    select: { id: true },
  });
  if (knownTerms.length !== termIds.length) {
    return withCors(request, Response.json({ error: "Unknown term in submission" }, { status: 400 }));
  }

  const userId = auth.user.sub;
  await prisma.$transaction(
    body.entries.map((e) =>
      prisma.intentToWork.upsert({
        where: {
          userId_staffingCycleId_termId: {
            userId,
            staffingCycleId: cycle.id,
            termId: e.termId,
          },
        },
        create: {
          userId,
          staffingCycleId: cycle.id,
          termId: e.termId,
          status: e.status,
          notes: e.notes?.trim() || null,
        },
        update: {
          status: e.status,
          notes: e.notes?.trim() || null,
        },
      }),
    ),
  );

  return withCors(request, Response.json({ ok: true }));
}
