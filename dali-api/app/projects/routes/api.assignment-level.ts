import type { Route } from "./+types/api.assignment-level";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";

// POST /api/projects/assignments/:id/level
//
// Core-only correction tool for an already-finalized ProjectAssignment.level.
// The staffing flow remains the primary path for setting levels; this exists
// so Core can fix mistakes without rerunning a cycle.
//
// Guards:
//   - Eligibility ceiling: target level must be <= DomainEligibility.level
//     for (userId, domainId). Promotions still happen through the eligibility
//     editor, not here.
//   - Mentor orphan: any demotion is blocked while the member still holds
//     MentorshipPair rows as mentor on (project, term, domain). Reassign the
//     mentees first.

type Body = { level: "P1" | "P2" | "P3" };

const LEVEL_RANK: Record<"P1" | "P2" | "P3", number> = { P1: 1, P2: 2, P3: 3 };

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return o.level === "P1" || o.level === "P2" || o.level === "P3";
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  if (!(await isCore(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
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

  const assignment = await prisma.projectAssignment.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      userId: true,
      projectId: true,
      termId: true,
      domainId: true,
      level: true,
      domain: { select: { displayName: true } },
    },
  });
  if (!assignment) {
    return withCors(request, Response.json({ error: "Assignment not found" }, { status: 404 }));
  }

  if (assignment.level === body.level) {
    return withCors(request, Response.json({ ok: true, unchanged: true }));
  }

  const eligibility = await prisma.domainEligibility.findUnique({
    where: {
      userId_domainId: { userId: assignment.userId, domainId: assignment.domainId },
    },
    select: { level: true },
  });
  const ceiling = eligibility?.level ?? null;
  if (!ceiling || LEVEL_RANK[body.level] > LEVEL_RANK[ceiling]) {
    return withCors(
      request,
      Response.json(
        {
          error: `Member is not eligible for ${body.level} in ${assignment.domain.displayName}. Promote them in the eligibility editor first.`,
        },
        { status: 400 },
      ),
    );
  }

  const isDemotion = LEVEL_RANK[body.level] < LEVEL_RANK[assignment.level];
  if (isDemotion) {
    const menteeCount = await prisma.mentorshipPair.count({
      where: {
        mentorUserId: assignment.userId,
        projectId: assignment.projectId,
        termId: assignment.termId,
        domainId: assignment.domainId,
      },
    });
    if (menteeCount > 0) {
      return withCors(
        request,
        Response.json(
          {
            error: `Cannot demote: member is mentoring ${menteeCount} mentee${menteeCount === 1 ? "" : "s"} in ${assignment.domain.displayName}. Reassign mentees first.`,
          },
          { status: 409 },
        ),
      );
    }
  }

  await prisma.projectAssignment.update({
    where: { id: assignment.id },
    data: { level: body.level },
  });

  await logAuditEvent({
    action: "project.assignment.level",
    userId: auth.user.sub,
    targetId: assignment.userId,
    metadata: {
      assignmentId: assignment.id,
      projectId: assignment.projectId,
      termId: assignment.termId,
      domainId: assignment.domainId,
      from: assignment.level,
      to: body.level,
    },
    request,
  });

  return withCors(request, Response.json({ ok: true, level: body.level }));
}
