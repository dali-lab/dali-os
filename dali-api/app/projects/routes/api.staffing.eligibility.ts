import type { Route } from "./+types/api.staffing.eligibility";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";
import { isLevel, type Level } from "~/lib/level";
import { addOrUpdateEligibility } from "~/admin-console/lib/eligibility.server";
import { publishCycleChange } from "../lib/staffing-events.server";
import { dedupeLiveAssignments } from "../lib/staffing-board";

// POST /api/staffing/eligibility
//
// Upsert a member's DomainEligibility (domain + level) from the staffing board
// card chips. When they have a live assignment in that domain for the cycle,
// rewrite the Proposed (or mint a Proposed over Confirmed) so Propagate uses
// the new level. Gated to staffing managers.

type Body = {
  cycleId: string;
  userId: string;
  domainId: string;
  level: Level;
};

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.cycleId === "string" &&
    typeof o.userId === "string" &&
    typeof o.domainId === "string" &&
    isLevel(o.level)
  );
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  if (!(await canManageStaffing(auth.user.sub))) {
    return forbidden(request);
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

  const [cycle, domain, user] = await Promise.all([
    prisma.staffingCycle.findUnique({
      where: { id: body.cycleId },
      select: { id: true, termId: true },
    }),
    prisma.domain.findUnique({
      where: { id: body.domainId },
      select: { id: true, name: true, displayName: true },
    }),
    prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true },
    }),
  ]);
  if (!cycle) {
    return withCors(request, Response.json({ error: "Cycle not found" }, { status: 404 }));
  }
  if (!domain) {
    return withCors(request, Response.json({ error: "Domain not found" }, { status: 404 }));
  }
  if (!user) {
    return withCors(request, Response.json({ error: "User not found" }, { status: 404 }));
  }

  await addOrUpdateEligibility({
    userId: body.userId,
    domainId: body.domainId,
    level: body.level,
    actorId: auth.user.sub,
  });

  // If they're live-assigned in this domain, keep the board assignment level
  // in sync so Propagate / mentorship pairing sees the new level. Preserve any
  // other selected domains on the same project (multi-domain staffing).
  const cycleRows = await prisma.staffingAssignment.findMany({
    where: {
      staffingCycleId: cycle.id,
      userId: body.userId,
      status: { in: ["Proposed", "Confirmed"] },
    },
    select: {
      id: true,
      userId: true,
      projectId: true,
      domainId: true,
      level: true,
      status: true,
    },
  });
  const liveRows = dedupeLiveAssignments(cycleRows);
  const match = liveRows.find((r) => r.domainId === body.domainId) ?? null;
  if (match && match.level !== body.level && match.projectId) {
    const siblings = liveRows.filter((r) => r.projectId === match.projectId);
    const nextDomains = siblings.map((r) =>
      r.domainId === body.domainId
        ? { domainId: r.domainId, level: body.level }
        : { domainId: r.domainId, level: r.level },
    );
    await prisma.$transaction(async (tx) => {
      await tx.staffingAssignment.deleteMany({
        where: {
          userId: body.userId,
          staffingCycleId: cycle.id,
          status: "Proposed",
        },
      });
      for (const d of nextDomains) {
        await tx.staffingAssignment.create({
          data: {
            userId: body.userId,
            staffingCycleId: cycle.id,
            projectId: match.projectId,
            termId: cycle.termId,
            domainId: d.domainId,
            level: d.level,
            status: "Proposed",
            assignedById: auth.user.sub,
          },
        });
      }
    });
  }

  await logAuditEvent({
    action: "staffing.eligibility.set",
    userId: auth.user.sub,
    targetId: body.userId,
    metadata: {
      cycleId: body.cycleId,
      domainId: body.domainId,
      level: body.level,
    },
    request,
  });

  publishCycleChange(cycle.id);

  return withCors(
    request,
    Response.json({
      ok: true,
      domainId: body.domainId,
      domainName: domain.displayName || domain.name,
      level: body.level,
    }),
  );
}
