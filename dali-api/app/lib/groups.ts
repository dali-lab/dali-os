import { prisma } from "~/lib/db";

// Single source of truth for resolving a GroupDefinition to its member userIds.
// Notification fan-out and meeting participant resolution both go through this.
// Static groups return their explicit member list; Dynamic groups dispatch on
// dynamicQuery and resolve against the underlying entity (term/project/domain
// assignments, or current-term Core).
export async function resolveGroupMembers(groupId: string): Promise<string[]> {
  const group = await prisma.groupDefinition.findUnique({
    where: { id: groupId },
    select: { type: true, dynamicQuery: true, staticMemberIds: true },
  });
  if (!group) return [];
  if (group.type === "Static") return group.staticMemberIds;
  if (!group.dynamicQuery) return [];
  return resolveDynamicQuery(group.dynamicQuery);
}

// Resolve a dynamicQuery string to userIds. Exported for callers that already
// have the query in hand (e.g. visibility filters that batch-resolve groups).
export async function resolveDynamicQuery(query: string): Promise<string[]> {
  const [kind, id] = query.split(":", 2);
  switch (kind) {
    case "term":
      return id ? resolveTermMembers(id) : [];
    case "project":
      return id ? resolveProjectMembers(id) : [];
    case "domain":
      return id ? resolveDomainMembers(id) : [];
    case "core":
      return resolveCoreMembers();
    default:
      return [];
  }
}

async function resolveTermMembers(termId: string): Promise<string[]> {
  // A member is "active in term T" if they have any project assignment, Core
  // assignment, instructor assignment, or mentorship pair (as mentor or
  // mentee) in T. DomainEligibility is term-independent and not included.
  const [projects, core, instructors, mentorshipMentee, mentorshipMentor] =
    await Promise.all([
      prisma.projectAssignment.findMany({ where: { termId }, select: { userId: true } }),
      prisma.coreAssignment.findMany({ where: { termId }, select: { userId: true } }),
      prisma.instructorAssignment.findMany({ where: { termId }, select: { userId: true } }),
      prisma.mentorshipPair.findMany({ where: { termId }, select: { menteeUserId: true } }),
      prisma.mentorshipPair.findMany({ where: { termId }, select: { mentorUserId: true } }),
    ]);
  const set = new Set<string>();
  for (const r of projects) set.add(r.userId);
  for (const r of core) set.add(r.userId);
  for (const r of instructors) set.add(r.userId);
  for (const r of mentorshipMentee) set.add(r.menteeUserId);
  for (const r of mentorshipMentor) set.add(r.mentorUserId);
  return [...set];
}

async function resolveProjectMembers(projectId: string): Promise<string[]> {
  const rows = await prisma.projectAssignment.findMany({
    where: { projectId },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((r) => r.userId);
}

async function resolveDomainMembers(domainId: string): Promise<string[]> {
  const rows = await prisma.domainEligibility.findMany({
    where: { domainId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

async function resolveCoreMembers(): Promise<string[]> {
  const termId = await getCurrentTermId();
  if (!termId) return [];
  const rows = await prisma.coreAssignment.findMany({
    where: { termId },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((r) => r.userId);
}

// Current term = the Term whose [startDate, endDate] window contains now.
// If multiple windows overlap (rare seed edge case), prefer the largest
// sortKey. Returns null if no term covers today.
export async function getCurrentTermId(): Promise<string | null> {
  const now = new Date();
  const term = await prisma.term.findFirst({
    where: { startDate: { lte: now }, endDate: { gte: now } },
    orderBy: { sortKey: "desc" },
    select: { id: true },
  });
  return term?.id ?? null;
}

// Every current lab member's userId. "Lab member" = a User with a DALIMember
// marker row who is also placed in at least one domain (has a DomainEligibility
// row). Members not yet assigned to any domain are excluded from the "whole
// lab" announcement audience.
export async function resolveAllLabMembers(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      daliMember: { isNot: null },
      domainEligibilities: { some: {} },
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export type VisibleGroup = {
  id: string;
  name: string;
  type: "Static" | "Dynamic";
  dynamicQuery: string | null;
  systemKey: string | null;
  memberIds: string[];
  // Effective archived state, combining a manual archive (archivedAt set) with
  // term-bound auto-archive (every bound term has ended). See isGroupArchived.
  archived: boolean;
  // Set only when manually archived; null otherwise. Lets the UI tell apart
  // "archived because its term ended" from "someone archived it".
  archivedAt: string | null;
  boundTermIds: string[];
};

// A static group is archived if it was manually archived (archivedAt set) OR
// it is term-bound and every bound term has already ended. `now` is passed in
// so callers can resolve a whole list against one consistent clock.
export function isGroupArchived(
  group: { archivedAt: Date | string | null; boundTermIds: string[] },
  termEndById: Map<string, Date>,
  now: Date,
): boolean {
  if (group.archivedAt) return true;
  if (group.boundTermIds.length === 0) return false;
  // Resolve each bound term's end; unknown ids (deleted terms) are ignored.
  const ends = group.boundTermIds
    .map((id) => termEndById.get(id))
    .filter((d): d is Date => d instanceof Date);
  if (ends.length === 0) return false;
  const latestEnd = ends.reduce((a, b) => (a > b ? a : b));
  return latestEnd.getTime() < now.getTime();
}

// Resolves every group to a VisibleGroup (members + derived archive state),
// without any per-viewer filtering. Shared by the membership-scoped and
// management list functions below.
async function resolveAllGroups(): Promise<VisibleGroup[]> {
  const [groups, terms] = await Promise.all([
    prisma.groupDefinition.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        type: true,
        dynamicQuery: true,
        staticMemberIds: true,
        systemKey: true,
        archivedAt: true,
        boundTermIds: true,
      },
    }),
    prisma.term.findMany({ select: { id: true, endDate: true } }),
  ]);

  const termEndById = new Map(terms.map((t) => [t.id, t.endDate]));
  const now = new Date();

  return Promise.all(
    groups.map(async (g) => {
      const memberIds =
        g.type === "Static"
          ? g.staticMemberIds
          : g.dynamicQuery
            ? await resolveDynamicQuery(g.dynamicQuery)
            : [];
      return {
        id: g.id,
        name: g.name,
        type: g.type,
        dynamicQuery: g.dynamicQuery,
        systemKey: g.systemKey,
        memberIds,
        archived: isGroupArchived(g, termEndById, now),
        archivedAt: g.archivedAt ? g.archivedAt.toISOString() : null,
        boundTermIds: g.boundTermIds,
      };
    }),
  );
}

// Returns the groups the given user belongs to. Static membership is read
// directly off the row; Dynamic groups are resolved via dynamicQuery. Use this
// at consumer sites (e.g. "groups I'm in") so groups stay hidden from
// non-members. The management page uses listAllGroups instead.
export async function listVisibleGroupsForUser(
  userId: string,
): Promise<VisibleGroup[]> {
  const resolved = await resolveAllGroups();
  return resolved.filter((g) => g.memberIds.includes(userId));
}

// Returns every group, unfiltered. For the Groups management page, where a
// Core/Admin user manages groups they may not belong to — so a group created
// without adding yourself still shows up.
export async function listAllGroups(): Promise<VisibleGroup[]> {
  return resolveAllGroups();
}

// Idempotent helpers used at entity-creation sites. Each ensures the matching
// default group exists; the unique systemKey makes repeated calls safe.
export async function ensureTermGroup(termId: string, code: string) {
  const systemKey = `term:${termId}`;
  await prisma.groupDefinition.upsert({
    where: { systemKey },
    update: { name: `Term ${code}` },
    create: {
      name: `Term ${code}`,
      type: "Dynamic",
      dynamicQuery: systemKey,
      systemKey,
    },
  });
}

export async function ensureProjectGroup(projectId: string, name: string) {
  const systemKey = `project:${projectId}`;
  await prisma.groupDefinition.upsert({
    where: { systemKey },
    update: { name: `Project ${name}` },
    create: {
      name: `Project ${name}`,
      type: "Dynamic",
      dynamicQuery: systemKey,
      systemKey,
    },
  });
}

export async function ensureDomainGroup(domainId: string, displayName: string) {
  const systemKey = `domain:${domainId}`;
  await prisma.groupDefinition.upsert({
    where: { systemKey },
    update: { name: `Domain ${displayName}` },
    create: {
      name: `Domain ${displayName}`,
      type: "Dynamic",
      dynamicQuery: systemKey,
      systemKey,
    },
  });
}

export async function ensureCoreGroup() {
  await prisma.groupDefinition.upsert({
    where: { systemKey: "core" },
    update: {},
    create: {
      name: "Core",
      type: "Dynamic",
      dynamicQuery: "core",
      systemKey: "core",
    },
  });
}

// Idempotent backfill: ensures every existing Term/Project/Domain has its
// default group, plus the Core singleton. Called after seed runs so a fresh
// `prisma migrate reset && prisma db seed` ends with all default groups
// present (the migration alone covers prod, where data already exists).
export async function syncDefaultGroups() {
  const [terms, projects, domains] = await Promise.all([
    prisma.term.findMany({ select: { id: true, code: true } }),
    prisma.project.findMany({ select: { id: true, name: true } }),
    prisma.domain.findMany({ select: { id: true, displayName: true } }),
  ]);
  await Promise.all([
    ensureCoreGroup(),
    ...terms.map((t) => ensureTermGroup(t.id, t.code)),
    ...projects.map((p) => ensureProjectGroup(p.id, p.name)),
    ...domains.map((d) => ensureDomainGroup(d.id, d.displayName)),
  ]);
}
