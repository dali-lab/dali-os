// Server-side Activities resolution + authoring (specs/activities.md §7). The
// layout loader calls resolveActiveActivitiesForUser once per navigation (gated
// on the `activities` flag) and plumbs the result to the client; the surface
// route uses getActivityForMember + the mechanic registry; the admin routes use
// the CRUD helpers. `kind` is validated against the registry, never a DB enum.

import { prisma } from "~/lib/db";
import { Prisma, type Activity, type ActivityStatus } from "~/generated/prisma/client";
import type { UserRoles } from "~/lib/roles";
import { resolveGroupMembers } from "~/lib/groups";
import { ROLE_TARGETS } from "~/lib/feature-flags";
import {
  isActivityActive,
  isActivityKind,
  matchesAudienceRoles,
  type ActiveActivity,
  type ActivityKind,
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
      const userEvents = await prisma.activityEvent.findMany({
        where: { activityId: a.id, userId },
      });
      progressLabel = mech.bannerSummary(a, userEvents);
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
};

export async function getActivityForMember(
  id: string,
  userId: string,
  roles: UserRoles,
): Promise<MemberActivity | null> {
  const activity = await prisma.activity.findUnique({ where: { id } });
  if (!activity) return null;
  return {
    activity,
    assigned: await isAssigned(activity, userId, roles),
    active: isActivityActive(activity, new Date()),
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

// Clone an activity (its config + audience) into a fresh Draft, so a hunt can be
// reused next term without a redeploy. Participants and events are NOT copied —
// a clone starts a new run. termId is cleared (set it for the new term); the
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
      config: src.config as Prisma.InputJsonValue,
      createdById,
    },
  });
}
