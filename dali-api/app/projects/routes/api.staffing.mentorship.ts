import type { Route } from "./+types/api.staffing.mentorship";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";
import { publishCycleChange } from "../lib/staffing-events.server";

// Staged mentor/mentee pairings for the staffing board's per-column side panel.
// Staged (not live MentorshipPair) until the mentee's project is finalized —
// see StagedMentorshipPair in schema.prisma and the materialization in
// api.staffing.finalize. Gated to staffing managers, like the rest of the board.
//
//   GET    ?cycleId=&projectId=
//            → { pairs, mentees, mentors } for that project's side panel.
//            mentees = members on the project's board column (their staged
//            assignment's domain/level). mentors = every lab member this term,
//            each with their level in the mentee-domain context resolved so the
//            UI can flag "will be promoted to P3 at finalize".
//   POST   { cycleId, projectId, menteeUserId, mentorUserId, domainId }
//            → stage a pairing (idempotent on the unique key).
//   DELETE ?id=…&id=…  → unstage.

type CreateBody = {
  cycleId: string;
  projectId: string;
  menteeUserId: string;
  mentorUserId: string;
  domainId: string;
};

function isCreateBody(x: unknown): x is CreateBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.cycleId === "string" &&
    typeof o.projectId === "string" &&
    typeof o.menteeUserId === "string" &&
    typeof o.mentorUserId === "string" &&
    typeof o.domainId === "string"
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await canManageStaffing(auth.user.sub))) return forbidden(request);

  const url = new URL(request.url);
  const cycleId = url.searchParams.get("cycleId");
  if (!cycleId) {
    return withCors(request, Response.json({ error: "cycleId required" }, { status: 400 }));
  }

  const cycle = await prisma.staffingCycle.findUnique({
    where: { id: cycleId },
    select: { id: true, termId: true },
  });
  if (!cycle) return withCors(request, Response.json({ error: "Cycle not found" }, { status: 404 }));

  // Cycle-wide: each staffed member's live assignment (Proposed wins over
  // Confirmed; declined excluded), so the board can resolve any card's
  // (projectId, domainId) by userId. The mentor badge lives on the card, so
  // one fetch feeds every column.
  const assignments = await prisma.staffingAssignment.findMany({
    where: { staffingCycleId: cycleId, status: { not: "Declined" } },
    select: {
      userId: true,
      projectId: true,
      domainId: true,
      level: true,
      status: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
  const liveByUser = new Map<string, (typeof assignments)[number]>();
  for (const a of assignments) {
    const cur = liveByUser.get(a.userId);
    if (!cur || (cur.status === "Confirmed" && a.status === "Proposed")) liveByUser.set(a.userId, a);
  }
  // userId → the member's live (projectId, domainId, level, name) on the board.
  // These are the mentee candidates (the badge lives on the mentor's card and
  // assigns mentees to them).
  const mentees = [...liveByUser.values()].map((a) => ({
    userId: a.userId,
    projectId: a.projectId,
    domainId: a.domainId,
    level: a.level,
    firstName: a.user.firstName,
    lastName: a.user.lastName,
  }));

  // Mentor pool = every lab member active this term. External mentors (staffed
  // on another project than the mentee) are included by design; a mentor need
  // not be P3 yet — finalize promotes them. `levelByDomain` lets the badge flag
  // "will be promoted to P3" for the mentee's domain. onProjectId lets the
  // client compute external-ness relative to whichever card the badge is on.
  const [members, pairs] = await Promise.all([
    prisma.user.findMany({
      where: { daliMember: { isNot: null } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        domainEligibilities: { select: { domainId: true, level: true } },
        staffingAssignments: {
          where: { staffingCycleId: cycleId, status: { not: "Declined" } },
          select: { projectId: true },
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.stagedMentorshipPair.findMany({
      where: { staffingCycleId: cycleId },
      select: {
        id: true,
        projectId: true,
        menteeUserId: true,
        mentorUserId: true,
        domainId: true,
        mentee: { select: { firstName: true, lastName: true } },
        mentor: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const mentors = members.map((m) => {
    const onProject = m.staffingAssignments[0]?.projectId ?? null;
    const eligByDomain = new Map(m.domainEligibilities.map((e) => [e.domainId, e.level]));
    return {
      userId: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      onProjectId: onProject,
      levelByDomain: Object.fromEntries(eligByDomain),
    };
  });

  return withCors(
    request,
    Response.json({
      termId: cycle.termId,
      mentees,
      mentors,
      pairs: pairs.map((p) => ({
        id: p.id,
        projectId: p.projectId,
        menteeUserId: p.menteeUserId,
        mentorUserId: p.mentorUserId,
        domainId: p.domainId,
        mentee: p.mentee,
        mentor: p.mentor,
      })),
    }),
  );
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await canManageStaffing(auth.user.sub))) return forbidden(request);

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const ids = url.searchParams.getAll("id").filter(Boolean);
    if (ids.length === 0) {
      return withCors(request, Response.json({ error: "No ids provided" }, { status: 400 }));
    }
    const rows = await prisma.stagedMentorshipPair.findMany({
      where: { id: { in: ids } },
      select: { staffingCycleId: true },
    });
    const result = await prisma.stagedMentorshipPair.deleteMany({ where: { id: { in: ids } } });
    for (const cycleId of new Set(rows.map((r) => r.staffingCycleId))) publishCycleChange(cycleId);
    return withCors(request, Response.json({ deleted: result.count }));
  }

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isCreateBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }
  if (body.menteeUserId === body.mentorUserId) {
    return withCors(request, Response.json({ error: "A member can't mentor themselves" }, { status: 400 }));
  }

  // Validate the referenced rows exist and belong together, so a stale client
  // can't stage a pair against a deleted cycle/project/domain/user.
  const [cycle, project, domain, mentee, mentor] = await Promise.all([
    prisma.staffingCycle.findUnique({ where: { id: body.cycleId }, select: { id: true } }),
    prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true } }),
    prisma.domain.findUnique({ where: { id: body.domainId }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: body.menteeUserId }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: body.mentorUserId }, select: { id: true } }),
  ]);
  if (!cycle || !project || !domain || !mentee || !mentor) {
    return withCors(request, Response.json({ error: "Unknown cycle, project, domain, or user" }, { status: 404 }));
  }

  // Idempotent on the unique key — re-staging the same pair returns the existing.
  const existing = await prisma.stagedMentorshipPair.findUnique({
    where: {
      staffingCycleId_menteeUserId_mentorUserId_domainId: {
        staffingCycleId: body.cycleId,
        menteeUserId: body.menteeUserId,
        mentorUserId: body.mentorUserId,
        domainId: body.domainId,
      },
    },
    select: { id: true },
  });
  const row =
    existing ??
    (await prisma.stagedMentorshipPair.create({
      data: {
        staffingCycleId: body.cycleId,
        projectId: body.projectId,
        menteeUserId: body.menteeUserId,
        mentorUserId: body.mentorUserId,
        domainId: body.domainId,
        createdById: auth.user.sub,
      },
      select: { id: true },
    }));

  if (!existing) {
    await logAuditEvent({
      action: "staffing.mentorship.stage",
      userId: auth.user.sub,
      targetId: body.projectId,
      metadata: { menteeUserId: body.menteeUserId, mentorUserId: body.mentorUserId, domainId: body.domainId },
      request,
    });
    publishCycleChange(body.cycleId);
  }

  return withCors(request, Response.json({ id: row.id }, { status: existing ? 200 : 201 }));
}
