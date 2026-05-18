import type { Route } from "./+types/api.project-bids";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { requireMember } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

// POST /api/projects/project-bids
//
// A lab member submits their ranked project preferences ("bids") for the
// active staffing cycle. Body:
//   { cycleId, bids: [{ projectId, domainId, notes? }, ...] }
// bids[i] is rank i+1 (the array order IS the ranking).
//
// Staffing has no open/close lifecycle (one cycle per term, always open), so
// there's no status gate; the page resolves/creates the cycle.
//
// Rules enforced server-side (the UI also enforces them, but never trust it):
//   - Self-only: rows are keyed to the authenticated user.
//   - At most min(3, cycle.maxPreferencesPerMember) bids.
//   - Each bid's domain must be one the member has DomainEligibility in, and
//     the project must have a ProjectRoleRequest for that domain in the
//     cycle's term. Level is taken from the member's eligibility in that
//     domain (not client-supplied — staffing reads it off the card).
//
// Submitting replaces the member's entire preference set for this cycle, so
// the staffing board reflects exactly the latest bid.

type Bid = { projectId: string; domainId: string; notes?: string };
type Body = { cycleId: string; bids: Bid[] };

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.cycleId !== "string") return false;
  if (!Array.isArray(o.bids)) return false;
  return o.bids.every((b) => {
    if (!b || typeof b !== "object") return false;
    const r = b as Record<string, unknown>;
    if (typeof r.projectId !== "string") return false;
    if (typeof r.domainId !== "string") return false;
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
    select: { id: true, termId: true, maxPreferencesPerMember: true },
  });
  if (!cycle) {
    return withCors(request, Response.json({ error: "Cycle not found" }, { status: 404 }));
  }

  const maxBids = Math.min(3, cycle.maxPreferencesPerMember);
  if (body.bids.length > maxBids) {
    return withCors(
      request,
      Response.json({ error: `You can bid on at most ${maxBids} projects.` }, { status: 400 }),
    );
  }

  // No duplicate (project, domain) pairs — that would be the same bid twice.
  const seen = new Set(body.bids.map((b) => `${b.projectId}:${b.domainId}`));
  if (seen.size !== body.bids.length) {
    return withCors(request, Response.json({ error: "Duplicate bid" }, { status: 400 }));
  }

  const userId = auth.user.sub;

  // The member's eligibility map: domainId -> level. A bid is only valid in a
  // domain they're eligible in, and we record that eligibility level.
  const eligibilities = await prisma.domainEligibility.findMany({
    where: { userId },
    select: { domainId: true, level: true },
  });
  const levelByDomain = new Map(eligibilities.map((e) => [e.domainId, e.level]));

  // Projects that actually have an open role in (term, domain) the member is
  // eligible for. Keyed for O(1) validation below.
  const roleRequests = await prisma.projectRoleRequest.findMany({
    where: {
      termId: cycle.termId,
      domainId: { in: [...levelByDomain.keys()] },
    },
    select: { projectId: true, domainId: true },
  });
  const openRoles = new Set(roleRequests.map((r) => `${r.projectId}:${r.domainId}`));

  for (const b of body.bids) {
    if (!levelByDomain.has(b.domainId)) {
      return withCors(
        request,
        Response.json({ error: "You are not eligible in one of the chosen domains." }, { status: 400 }),
      );
    }
    if (!openRoles.has(`${b.projectId}:${b.domainId}`)) {
      return withCors(
        request,
        Response.json(
          { error: "One of the chosen projects has no open role in that domain this term." },
          { status: 400 },
        ),
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    // Replace the whole set: a resubmission is authoritative.
    await tx.staffingPreference.deleteMany({
      where: { userId, staffingCycleId: cycle.id },
    });
    if (body.bids.length > 0) {
      await tx.staffingPreference.createMany({
        data: body.bids.map((b, i) => ({
          userId,
          staffingCycleId: cycle.id,
          projectId: b.projectId,
          domainId: b.domainId,
          level: levelByDomain.get(b.domainId)!,
          preferenceRank: i + 1,
          notes: b.notes?.trim() || null,
        })),
      });
    }
  });

  return withCors(request, Response.json({ ok: true }));
}
