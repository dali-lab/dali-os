// Server-side Activities resolution + authoring (specs/activities.md §7). The
// layout loader calls resolveActiveActivitiesForUser once per navigation and
// plumbs the result to the client; the surface
// route uses getActivityForMember + the mechanic registry; the admin routes use
// the CRUD helpers. `kind` is validated against the registry, never a DB enum.

import { prisma } from "~/lib/db";
import {
  Prisma,
  type Activity,
  type ActivityScoring,
  type ActivityStatus,
} from "~/generated/prisma/client";
import { getActiveCoreCycleTermIds, getAdminUserIdsFromEnv, type UserRoles } from "~/lib/roles";
import { resolveGroupMembers } from "~/lib/groups";
import { fullName } from "~/lib/display";
import { LAB_MEMBER_WHERE, MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { ROLE_TARGETS } from "~/lib/feature-flags";
import {
  clampTeamSize,
  isActivityActive,
  isActivityKind,
  matchesAudienceRoles,
  type ActiveActivity,
  type ActivityKind,
  type ActivityTeamView,
  type RosterMember,
} from "~/lib/activities";
import { mechanicServer } from "~/activities/mechanics/registry.server";

// ─── Audience ────────────────────────────────────────────────────────────────
// everyone ∪ role ∪ assigned group ∪ explicit participant. The role half is the
// pure matchesAudienceRoles; the group + participant halves need the DB.

export async function isAssigned(
  activity: Pick<
    Activity,
    "id" | "audienceEveryone" | "audienceRoles" | "assignedGroupId"
  >,
  userId: string,
  roles: UserRoles,
): Promise<boolean> {
  if (activity.audienceEveryone) return true;
  if (matchesAudienceRoles(activity.audienceRoles, roles)) return true;

  const explicit = await prisma.activityParticipant.findUnique({
    where: { activityId_userId: { activityId: activity.id, userId } },
    select: { userId: true },
  });
  if (explicit) return true;

  if (activity.assignedGroupId) {
    const members = await resolveGroupMembers(activity.assignedGroupId);
    if (members.includes(userId)) return true;
  }
  return false;
}

// ─── Roster (who this activity's audience actually resolves to) ─────────────
// isAssigned answers "is THIS user in?" one user at a time, which is all the
// shell needs. Team assignment needs the other direction — the list of everyone
// in — so the admin editor can auto-assign them and search them by name.

// Users matching a ROLE_TARGETS key. Mirrors the per-user predicates in
// getUserRoles (roles.ts), read the other way round: one findMany per role
// instead of one findUnique per user. Roles the DB can't answer in a single
// query aren't guessed at — every target here has a backing table.
async function resolveRoleTargetMembers(roleKeys: string[]): Promise<string[]> {
  const wanted = new Set(roleKeys);
  if (wanted.size === 0) return [];
  const ids = new Set<string>();
  const add = (rows: { userId: string }[]) => rows.forEach((r) => ids.add(r.userId));

  // Admin/Core/Staff all read AdminMembership, so fetch it once.
  const needsAdmin = wanted.has("isAdmin") || wanted.has("isCore") || wanted.has("isStaff");
  if (needsAdmin) {
    const admins = await prisma.adminMembership.findMany({
      select: { userId: true, isStaff: true },
    });
    if (wanted.has("isAdmin") || wanted.has("isCore")) add(admins);
    if (wanted.has("isStaff")) add(admins.filter((a) => a.isStaff));
  }
  if (wanted.has("isAdmin") || wanted.has("isCore")) {
    getAdminUserIdsFromEnv().forEach((id) => ids.add(id));
  }
  if (wanted.has("isCore")) {
    // Core tracks the active election cycle, same window as computeIsCore.
    const cycleTermIds = await getActiveCoreCycleTermIds();
    if (cycleTermIds.length > 0) {
      add(
        await prisma.coreAssignment.findMany({
          where: { termId: { in: cycleTermIds } },
          select: { userId: true },
        }),
      );
    }
  }
  if (wanted.has("isDomainLead")) {
    add(await prisma.domainLeadAssignment.findMany({ select: { userId: true } }));
  }
  if (wanted.has("isInstructor")) {
    add(await prisma.instructorAssignment.findMany({ select: { userId: true } }));
  }
  if (wanted.has("isInterviewer")) {
    add(await prisma.cycleInterviewer.findMany({ select: { userId: true } }));
  }
  if (wanted.has("isAlumni")) {
    const rows = await prisma.user.findMany({
      where: { membershipStatus: "Alumni" },
      select: { id: true },
    });
    rows.forEach((r) => ids.add(r.id));
  }
  return [...ids];
}

/**
 * Everyone this activity's audience resolves to right now: the union of
 * everyone / roles / assigned group / explicit participants, as display-ready
 * rows. Used by the admin teams editor (the auto-assign pool and the search
 * dropdown). Non-lab-members are filtered out — an activity is a lab thing, and
 * a stale id in a static group shouldn't show up as a nameless teammate.
 */
export async function resolveActivityRoster(
  activity: Pick<
    Activity,
    "id" | "audienceEveryone" | "audienceRoles" | "assignedGroupId"
  >,
): Promise<RosterMember[]> {
  let where: Prisma.UserWhereInput;
  if (activity.audienceEveryone) {
    where = LAB_MEMBER_WHERE;
  } else {
    const [roleIds, groupIds, participants] = await Promise.all([
      resolveRoleTargetMembers(activity.audienceRoles),
      activity.assignedGroupId ? resolveGroupMembers(activity.assignedGroupId) : [],
      prisma.activityParticipant.findMany({
        where: { activityId: activity.id },
        select: { userId: true },
      }),
    ]);
    const ids = [...new Set([...roleIds, ...groupIds, ...participants.map((p) => p.userId)])];
    if (ids.length === 0) return [];
    where = { ...LAB_MEMBER_WHERE, id: { in: ids } };
  }

  const rows = await prisma.user.findMany({
    where,
    select: { id: true, firstName: true, lastName: true },
    orderBy: MEMBER_LIST_ORDER_BY,
  });
  return rows.map((u) => ({ id: u.id, name: fullName(u) }));
}

// ─── Teams ───────────────────────────────────────────────────────────────────

export async function listActivityTeams(activityId: string): Promise<ActivityTeamView[]> {
  const rows = await prisma.activityTeam.findMany({
    where: { activityId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, members: { select: { userId: true } } },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    memberIds: t.members.map((m) => m.userId),
  }));
}

/**
 * Replace an activity's teams with `incoming`, which the admin editor holds as
 * client state (ids of teams it invented locally are temporary and get swapped
 * for real ones here — the client's ids are never trusted as row ids).
 *
 * Membership is mirrored onto ActivityParticipant, so putting someone on a team
 * also puts them in the activity. Taking them off one deletes only the row the
 * teams editor created (teamId non-null); a participant added some other way,
 * with no team, is left alone.
 */
export async function saveActivityTeams(
  activityId: string,
  incoming: ActivityTeamView[],
): Promise<void> {
  const existing = await prisma.activityTeam.findMany({
    where: { activityId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((t) => t.id));

  // Drop empty teams rather than persisting them — an editor session that adds
  // a team and never fills it shouldn't leave a ghost on the leaderboard.
  const kept = incoming.filter((t) => t.memberIds.length > 0);

  await prisma.$transaction(async (tx) => {
    const staleIds = [...existingIds].filter(
      (id) => !kept.some((t) => t.id === id),
    );
    if (staleIds.length > 0) {
      await tx.activityParticipant.deleteMany({
        where: { activityId, teamId: { in: staleIds } },
      });
      await tx.activityTeam.deleteMany({ where: { activityId, id: { in: staleIds } } });
    }

    const memberTeam = new Map<string, string>();
    for (const team of kept) {
      const name = team.name.trim().slice(0, 120) || "Team";
      let id = team.id;
      if (existingIds.has(id)) {
        await tx.activityTeam.update({ where: { id }, data: { name } });
      } else {
        const created = await tx.activityTeam.create({
          data: { activityId, name },
          select: { id: true },
        });
        id = created.id;
      }
      // A member named on two teams lands on the last one — the editor keeps
      // them exclusive, but the server shouldn't depend on that.
      for (const userId of team.memberIds) memberTeam.set(userId, id);
    }

    const keptMembers = [...memberTeam.keys()];
    await tx.activityParticipant.deleteMany({
      where: {
        activityId,
        teamId: { not: null },
        ...(keptMembers.length > 0 ? { userId: { notIn: keptMembers } } : {}),
      },
    });
    for (const [userId, teamId] of memberTeam) {
      await tx.activityParticipant.upsert({
        where: { activityId_userId: { activityId, userId } },
        create: { activityId, userId, teamId },
        update: { teamId },
      });
    }
  });
}

/** The team `userId` is on, or null (Individual activity, or unassigned). */
export async function resolveTeamForMember(
  activity: Pick<Activity, "id" | "scoring">,
  userId: string,
): Promise<ActivityTeamView | null> {
  if (activity.scoring !== "Team") return null;
  const row = await prisma.activityParticipant.findUnique({
    where: { activityId_userId: { activityId: activity.id, userId } },
    select: { teamId: true },
  });
  if (!row?.teamId) return null;
  const team = await prisma.activityTeam.findUnique({
    where: { id: row.teamId },
    select: { id: true, name: true, members: { select: { userId: true } } },
  });
  if (!team) return null;
  return { id: team.id, name: team.name, memberIds: team.members.map((m) => m.userId) };
}

// ─── Live-for-me resolution (layout loader → shell bar + on-page overlay) ────

export async function resolveActiveActivitiesForUser(
  userId: string,
  roles: UserRoles,
  now: Date,
  pathname: string,
): Promise<ActiveActivity[]> {
  const rows = await prisma.activity.findMany({
    where: { status: "Published", startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { startsAt: "asc" },
  });

  const out: ActiveActivity[] = [];
  for (const a of rows) {
    if (!(await isAssigned(a, userId, roles))) continue;
    const mech = mechanicServer(a.kind);
    const overlay = mech?.overlayPayload?.(a, pathname) ?? null;
    // Only the mechanics that summarize need the member's events; fetch them
    // lazily so a non-summarizing mechanic (or none) costs no extra query.
    let progressLabel: string | null = null;
    if (mech?.bannerSummary) {
      // In Team mode the bar counts the TEAM's progress — a code a partner
      // found is found, so a bar reading "2/8" next to a partner's "5/8" would
      // just be wrong. One extra indexed read, and only for team activities.
      const team = await resolveTeamForMember(a, userId);
      const events = await prisma.activityEvent.findMany({
        where: { activityId: a.id, userId: team ? { in: team.memberIds } : userId },
      });
      progressLabel = mech.bannerSummary(a, events);
    }
    out.push({
      id: a.id,
      kind: a.kind as ActivityKind,
      name: a.name,
      endsAt: a.endsAt.toISOString(),
      overlay,
      progressLabel,
    });
  }
  return out;
}

// ─── Surface route ───────────────────────────────────────────────────────────

export type MemberActivity = {
  activity: Activity;
  assigned: boolean;
  active: boolean;
  /** Team mode only: the team this member hunts with (null if unassigned). */
  team: ActivityTeamView | null;
};

export async function getActivityForMember(
  id: string,
  userId: string,
  roles: UserRoles,
): Promise<MemberActivity | null> {
  const activity = await prisma.activity.findUnique({ where: { id } });
  if (!activity) return null;
  const [assigned, team] = await Promise.all([
    isAssigned(activity, userId, roles),
    resolveTeamForMember(activity, userId),
  ]);
  return {
    activity,
    assigned,
    active: isActivityActive(activity, new Date()),
    team,
  };
}

// ─── Admin CRUD ──────────────────────────────────────────────────────────────

export type AdminActivityRow = {
  id: string;
  kind: string;
  name: string;
  status: ActivityStatus;
  termId: string | null;
  startsAt: Date;
  endsAt: Date;
  participantCount: number;
  eventCount: number;
};

export async function listActivitiesForAdmin(): Promise<AdminActivityRow[]> {
  const rows = await prisma.activity.findMany({
    orderBy: [{ startsAt: "desc" }],
    include: { _count: { select: { participants: true, events: true } } },
  });
  return rows.map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    status: a.status,
    termId: a.termId,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    participantCount: a._count.participants,
    eventCount: a._count.events,
  }));
}

function assertKind(kind: string): asserts kind is ActivityKind {
  if (!isActivityKind(kind)) throw new Error(`Unknown activity kind: ${kind}`);
}

function cleanRoles(roles: string[]): string[] {
  return roles.filter((r) => (ROLE_TARGETS as readonly string[]).includes(r));
}

export type CreateActivityInput = {
  kind: string;
  name: string;
  termId: string | null;
  startsAt: Date;
  endsAt: Date;
};

export async function createActivity(
  input: CreateActivityInput,
  createdById: string,
): Promise<Activity> {
  assertKind(input.kind);
  const mech = mechanicServer(input.kind);
  const config = mech ? mech.parseConfig({}) : {};
  return prisma.activity.create({
    data: {
      kind: input.kind,
      name: input.name,
      termId: input.termId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: "Draft",
      config: config as Prisma.InputJsonValue,
      createdById,
    },
  });
}

export type UpdateActivityPatch = {
  name?: string;
  termId?: string | null;
  startsAt?: Date;
  endsAt?: Date;
  audienceEveryone?: boolean;
  audienceRoles?: string[];
  assignedGroupId?: string | null;
  scoring?: ActivityScoring;
  teamSize?: number;
  config?: unknown;
};

export async function updateActivity(
  id: string,
  patch: UpdateActivityPatch,
): Promise<Activity> {
  const existing = await prisma.activity.findUnique({ where: { id } });
  if (!existing) throw new Error("Activity not found");

  const data: Prisma.ActivityUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.termId !== undefined) data.termId = patch.termId;
  if (patch.startsAt !== undefined) data.startsAt = patch.startsAt;
  if (patch.endsAt !== undefined) data.endsAt = patch.endsAt;
  if (patch.audienceEveryone !== undefined) data.audienceEveryone = patch.audienceEveryone;
  if (patch.audienceRoles !== undefined) data.audienceRoles = cleanRoles(patch.audienceRoles);
  if (patch.assignedGroupId !== undefined) data.assignedGroupId = patch.assignedGroupId;
  if (patch.scoring !== undefined) data.scoring = patch.scoring;
  if (patch.teamSize !== undefined) data.teamSize = clampTeamSize(patch.teamSize);
  if (patch.config !== undefined) {
    const mech = mechanicServer(existing.kind);
    const parsed = mech ? mech.parseConfig(patch.config) : patch.config;
    data.config = parsed as Prisma.InputJsonValue;
  }
  return prisma.activity.update({ where: { id }, data });
}

export async function setActivityStatus(
  id: string,
  status: ActivityStatus,
): Promise<Activity> {
  return prisma.activity.update({ where: { id }, data: { status } });
}

export async function deleteActivity(id: string): Promise<void> {
  await prisma.activity.delete({ where: { id } });
}

// Clone an activity (its config + audience + scoring setup) into a fresh Draft,
// so a hunt can be reused next term without a redeploy. Participants, teams and
// events are NOT copied — a clone starts a new run, and next term's pairings are
// next term's. termId is cleared (set it for the new term); the
// window is copied so the operator can shift it.
export async function cloneActivity(
  id: string,
  createdById: string,
): Promise<Activity> {
  const src = await prisma.activity.findUnique({ where: { id } });
  if (!src) throw new Error("Activity not found");
  return prisma.activity.create({
    data: {
      kind: src.kind,
      name: `${src.name} (copy)`,
      termId: null,
      startsAt: src.startsAt,
      endsAt: src.endsAt,
      status: "Draft",
      audienceEveryone: src.audienceEveryone,
      audienceRoles: src.audienceRoles,
      assignedGroupId: src.assignedGroupId,
      scoring: src.scoring,
      teamSize: src.teamSize,
      config: src.config as Prisma.InputJsonValue,
      createdById,
    },
  });
}
