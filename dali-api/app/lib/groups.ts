import { prisma } from "~/lib/db.server";
import { currentTerm, getActiveCoreCycleTermIds, isLabMentor } from "~/lib/roles";
import { ACTIVE_LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";

// Single source of truth for resolving a GroupDefinition to its member userIds.
// Notification fan-out and meeting participant resolution both go through this.
// Static groups return their explicit member list; Dynamic groups dispatch on
// dynamicQuery and resolve against the underlying entity (term/project/domain
// assignments, or the current Core cycle).
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

// `request` enables per-request memoization in currentTerm/getActiveCoreCycleTermIds.
// `coreMembers` is set by resolveDynamicQueries so "core", "hiring" and
// "mentors" share one read of Core's current members.
type DynamicQueryContext = {
  request?: Request;
  coreMembers?: Promise<string[]>;
};

// Resolve a dynamicQuery string to userIds. Exported for callers that already
// have the query in hand (e.g. visibility filters that batch-resolve groups).
export async function resolveDynamicQuery(
  query: string,
  ctx?: Pick<DynamicQueryContext, "request">,
): Promise<string[]> {
  return (await resolveDynamicQueries([query], ctx)).get(query) ?? [];
}

const EMPTY_MEMBERS = Promise.resolve(new Map<string, string[]>());

/**
 * Resolve many dynamicQuery strings at once, keyed by query. Each kind costs a
 * fixed number of reads however many groups use it: a page that resolved every
 * group one by one fired ~110 queries at once and queued the pool behind them.
 */
export async function resolveDynamicQueries(
  queries: string[],
  ctx?: Pick<DynamicQueryContext, "request">,
): Promise<Map<string, string[]>> {
  const idsByKind = new Map<string, string[]>();
  for (const query of new Set(queries)) {
    const [kind, id = ""] = query.split(":", 2);
    idsByKind.set(kind, [...(idsByKind.get(kind) ?? []), id]);
  }
  const ids = (kind: string) => (idsByKind.get(kind) ?? []).filter(Boolean);
  const has = (kind: string) => idsByKind.has(kind);
  const request = ctx?.request;
  const coreMembers =
    has("core") || has("hiring") || has("mentors") ? resolveCoreMembers(request) : undefined;
  const shared = { request, coreMembers };

  const [term, project, domain, offering, core, hiring, mentors, alumni] = await Promise.all([
    ids("term").length ? resolveTermMembers(ids("term")) : EMPTY_MEMBERS,
    ids("project").length ? resolveProjectMembers(ids("project"), request) : EMPTY_MEMBERS,
    ids("domain").length ? resolveDomainMembers(ids("domain")) : EMPTY_MEMBERS,
    ids("offering").length ? resolveOfferingMembers(ids("offering")) : EMPTY_MEMBERS,
    coreMembers ?? [],
    has("hiring") ? resolveHiringMembers(shared) : [],
    has("mentors") ? resolveMentorMembers(shared) : [],
    has("alumni") ? resolveAlumni() : [],
  ]);
  const byId = new Map(Object.entries({ term, project, domain, offering }));
  const whole = new Map(Object.entries({ core, hiring, mentors, alumni }));

  const result = new Map<string, string[]>();
  for (const query of queries) {
    const [kind, id = ""] = query.split(":", 2);
    result.set(query, byId.get(kind)?.get(id) ?? whole.get(kind) ?? []);
  }
  return result;
}

function membersByKey(pairs: Iterable<readonly [string, string]>): Map<string, string[]> {
  const sets = new Map<string, Set<string>>();
  for (const [key, userId] of pairs) {
    let set = sets.get(key);
    if (!set) sets.set(key, (set = new Set()));
    set.add(userId);
  }
  return new Map([...sets].map(([key, set]) => [key, [...set]]));
}

async function resolveTermMembers(termIds: string[]): Promise<Map<string, string[]>> {
  const termId = { in: termIds };
  const [projects, core, instructors, mentorships] = await Promise.all([
    prisma.projectAssignment.findMany({ where: { termId }, select: { termId: true, userId: true } }),
    prisma.coreAssignment.findMany({ where: { termId }, select: { termId: true, userId: true } }),
    prisma.instructorAssignment.findMany({
      where: { termId, user: { daliMember: { isNot: null } } },
      select: { termId: true, userId: true },
    }),
    prisma.mentorshipPair.findMany({
      where: { termId },
      select: { termId: true, menteeUserId: true, mentorUserId: true },
    }),
  ]);
  return membersByKey([
    ...[...projects, ...core, ...instructors].map((r) => [r.termId, r.userId] as const),
    ...mentorships.flatMap((r) => [
      [r.termId, r.menteeUserId] as const,
      [r.termId, r.mentorUserId] as const,
    ]),
  ]);
}

// The signing gate's "active in term T" check. Deliberately wider than the term
// group (resolveTermMembers): external instructors are not in the term group
// but must still sign the term's agreements.
export async function isUserActiveInTerm(userId: string, termId: string): Promise<boolean> {
  const hit = await prisma.user.findFirst({
    where: {
      id: userId,
      OR: [
        { projectAssignments: { some: { termId } } },
        { coreAssignments: { some: { termId } } },
        { instructorAssignments: { some: { termId } } },
        { mentorshipPairsAsMentor: { some: { termId } } },
        { mentorshipPairsAsMentee: { some: { termId } } },
      ],
    },
    select: { id: true },
  });
  return hit !== null;
}

/**
 * A project group is the people staffed on it *now*, not everyone who ever was.
 *
 * ProjectAssignment rows are per (user, project, term) and are never deleted, so
 * an unscoped query returns every member the project has ever had. That made
 * the derived group grow every term: alumni and members who rotated off kept
 * receiving the project's notifications and meeting invites.
 *
 * With no current term (an empty Term table, or a gap between terms with none
 * upcoming) nobody is currently staffed, so the group is empty — the same
 * answer term-scoped role resolution gives, and a safer default than
 * broadcasting to everyone who ever touched the project.
 */
async function resolveProjectMembers(
  projectIds: string[],
  request?: Request,
): Promise<Map<string, string[]>> {
  const term = await currentTerm(request);
  if (!term) return new Map();
  const rows = await prisma.projectAssignment.findMany({
    where: { projectId: { in: projectIds }, termId: term.id },
    select: { projectId: true, userId: true },
  });
  return membersByKey(rows.map((r) => [r.projectId, r.userId] as const));
}

// Members of an EducationOffering: users with an Approved application to that
// offering. "Approved" = the Education team accepted the application; it is the
// enrollment gate for both member-portal and Dartmouth-portal applicants.
async function resolveOfferingMembers(offeringIds: string[]): Promise<Map<string, string[]>> {
  const rows = await prisma.educationApplication.findMany({
    where: { offeringId: { in: offeringIds }, status: "Approved" },
    select: { offeringId: true, applicantUserId: true },
  });
  return membersByKey(rows.map((r) => [r.offeringId, r.applicantUserId] as const));
}

/**
 * A domain group is the people who work that domain *now*, not everyone who
 * ever qualified for it.
 *
 * DomainEligibility is monotonic and term-independent — rows are never deleted,
 * and graduating doesn't touch them — so an unfiltered query returns every
 * member the domain has ever had. Alumni kept receiving the domain's
 * notifications and meeting invites years after leaving; the same observation
 * is already recorded on resolveAllLabMembers below, which is why the "whole
 * lab" audience refuses to use a domain filter at all.
 *
 * Gating on the stored membershipStatus (rather than on term activity) keeps a
 * current member with no assignments yet — a fresh hire, someone between
 * projects — inside their domain's group.
 */
async function resolveDomainMembers(domainIds: string[]): Promise<Map<string, string[]>> {
  const rows = await prisma.domainEligibility.findMany({
    where: { domainId: { in: domainIds }, user: ACTIVE_LAB_MEMBER_WHERE },
    select: { domainId: true, userId: true },
  });
  return membersByKey(rows.map((r) => [r.domainId, r.userId] as const));
}

// Lab alumni — a DALIMember whose stored membershipStatus is Alumni. The
// symmetric counterpart to the "whole lab" (Active) audience: pick both to
// reach everyone. No existing audience targeted alumni before this.
async function resolveAlumni(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { daliMember: { isNot: null }, membershipStatus: "Alumni" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function resolveCoreMembers(request?: Request): Promise<string[]> {
  const cycleTermIds = await getActiveCoreCycleTermIds(request);
  if (cycleTermIds.length === 0) return [];
  const rows = await prisma.coreAssignment.findMany({
    where: { termId: { in: cycleTermIds } },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((r) => r.userId);
}

// "Has hiring access": Core plus anyone ever assigned a hiring role — domain
// leads and cycle reviewers/interviewers. Matches the nav's hasHiringAccess
// gate (which admits any-cycle reviewers forever), so this group governs who
// sees the Hiring drive scope and its artifacts.
async function resolveHiringMembers(ctx?: DynamicQueryContext): Promise<string[]> {
  const [core, leads, reviewers, interviewers] = await Promise.all([
    ctx?.coreMembers ?? resolveCoreMembers(ctx?.request),
    prisma.domainLeadAssignment.findMany({ select: { userId: true }, distinct: ["userId"] }),
    prisma.cycleReviewer.findMany({ select: { userId: true }, distinct: ["userId"] }),
    prisma.cycleInterviewer.findMany({ select: { userId: true }, distinct: ["userId"] }),
  ]);
  const set = new Set<string>(core);
  for (const r of leads) set.add(r.userId);
  for (const r of reviewers) set.add(r.userId);
  for (const r of interviewers) set.add(r.userId);
  return [...set];
}

// "Is a lab mentor": the bulk inverse of isLabMentor (roles.ts) for the current
// term, plus Core. Core is the Core group's own membership (active cycle), so
// the two groups can never disagree about who is Core.
async function resolveMentorMembers(ctx?: DynamicQueryContext): Promise<string[]> {
  const term = await currentTerm(ctx?.request);
  if (!term) return [];
  const termId = term.id;
  const [core, p3, leads, pmMentors] = await Promise.all([
    ctx?.coreMembers ?? resolveCoreMembers(ctx?.request),
    prisma.projectAssignment.findMany({
      where: { termId, level: "P3" },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.domainLeadAssignment.findMany({
      where: { termId },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.user.findMany({
      where: {
        domainEligibilities: { some: { level: "P3", domain: { code: "PM" } } },
        OR: [
          { projectAssignments: { some: { termId } } },
          { coreAssignments: { some: { termId } } },
          { domainLeadAssignmentsAsUser: { some: { termId } } },
          { instructorAssignments: { some: { termId } } },
        ],
      },
      select: { id: true },
    }),
  ]);
  const set = new Set<string>(core);
  for (const r of p3) set.add(r.userId);
  for (const r of leads) set.add(r.userId);
  for (const u of pmMentors) set.add(u.id);
  return [...set];
}

// Whether `userId` belongs to at least one of `groupIds`. Static membership
// is read straight off the rows (no resolver queries); Dynamic groups resolve
// one at a time with a short-circuit so a hit on the first never resolves the
// rest. Archived groups still admit — archiving a group after a form selected
// it must not silently lock the form; pickers block *selecting* archived
// groups instead.
export async function isUserInAnyGroup(
  userId: string,
  groupIds: string[],
): Promise<boolean> {
  if (groupIds.length === 0) return false;
  const groups = await prisma.groupDefinition.findMany({
    where: { id: { in: groupIds } },
    select: { type: true, dynamicQuery: true, staticMemberIds: true },
  });
  for (const g of groups) {
    if (g.type === "Static" && g.staticMemberIds.includes(userId)) return true;
  }
  for (const g of groups) {
    if (g.type !== "Dynamic" || !g.dynamicQuery) continue;
    const members = await resolveDynamicQuery(g.dynamicQuery);
    if (members.includes(userId)) return true;
  }
  return false;
}

// Every current lab member's userId — the "whole lab" announcement audience.
// "Current lab member" = a DALIMember whose membershipStatus is Active (i.e. not
// an alumnus). Deliberately term-independent so it reaches members with no
// assignments this term yet (e.g. a next-term hire), and deliberately NOT gated
// on domain placement: DomainEligibility survives graduation, so a domain filter
// both let alumni through and dropped freshly-accepted members. Alumni are a
// separate audience — the `alumni` system group.
export async function resolveAllLabMembers(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: ACTIVE_LAB_MEMBER_WHERE,
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

// The lookups isGroupArchived needs, resolved once per list so a whole page of
// groups is judged against one consistent clock (and one pair of queries).
export type GroupArchiveContext = {
  termEndById: Map<string, Date>;
  /** Projects with status Archived — their auto group archives with them. */
  archivedProjectIds: ReadonlySet<string>;
  now: Date;
};

// Loads the entity state the derived archive rule reads. Only the two call
// sites that actually compute `archived` pay for this; the ids-only hot path
// (listVisibleGroupIdsForUser) reads raw archivedAt and skips it.
export async function loadGroupArchiveContext(): Promise<GroupArchiveContext> {
  const [terms, archivedProjects] = await Promise.all([
    prisma.term.findMany({ select: { id: true, endDate: true } }),
    prisma.project.findMany({ where: { status: "Archived" }, select: { id: true } }),
  ]);
  return {
    termEndById: new Map(terms.map((t) => [t.id, t.endDate])),
    archivedProjectIds: new Set(archivedProjects.map((p) => p.id)),
    now: new Date(),
  };
}

// A group is archived if it was manually archived (archivedAt set), or it has
// outlived whatever it is scoped to:
//
//   • static, term-bound  — every term in boundTermIds has ended
//   • Dynamic "term:<id>" — that term has ended
//   • Dynamic "project:<id>" — that project is Archived
//
// The auto groups are the reason for the last two: ensureTermGroup /
// ensureProjectGroup mint one per term and per project and nothing ever retires
// them, so every finished term and dead project kept its group in the pickers
// forever. Derived rather than stored, like the term-bound rule above it —
// un-archiving a project brings its group straight back, and there is no job or
// migration to keep in sync. A Paused project keeps its group: it's expected
// back.
//
// Dynamic groups other than term/project (domain, core, hiring, mentors, alumni,
// offering) have nothing to outlive and never auto-archive.
export function isGroupArchived(
  group: {
    archivedAt: Date | string | null;
    boundTermIds: string[];
    dynamicQuery?: string | null;
  },
  ctx: GroupArchiveContext,
): boolean {
  if (group.archivedAt) return true;

  const [kind, id] = (group.dynamicQuery ?? "").split(":", 2);
  if (kind === "term" && id) return hasEnded(ctx.termEndById.get(id), ctx.now);
  if (kind === "project" && id) return ctx.archivedProjectIds.has(id);

  if (group.boundTermIds.length === 0) return false;
  // Resolve each bound term's end; unknown ids (deleted terms) are ignored.
  const ends = group.boundTermIds
    .map((tid) => ctx.termEndById.get(tid))
    .filter((d): d is Date => d instanceof Date);
  if (ends.length === 0) return false;
  const latestEnd = ends.reduce((a, b) => (a > b ? a : b));
  return latestEnd.getTime() < ctx.now.getTime();
}

// An unknown term id (deleted term) is not evidence the group is stale, so it
// stays active — same fallback the boundTermIds path takes.
function hasEnded(endDate: Date | undefined, now: Date): boolean {
  return endDate instanceof Date && endDate.getTime() < now.getTime();
}

// Resolves every group to a VisibleGroup (members + derived archive state),
// without any per-viewer filtering. Shared by the membership-scoped and
// management list functions below.
async function resolveAllGroups(request?: Request): Promise<VisibleGroup[]> {
  const [groups, archiveContext] = await Promise.all([
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
    loadGroupArchiveContext(),
  ]);
  return toVisibleGroups(groups, archiveContext, request);
}

type GroupRow = {
  id: string;
  name: string;
  type: "Static" | "Dynamic";
  dynamicQuery: string | null;
  staticMemberIds: string[];
  systemKey: string | null;
  archivedAt: Date | null;
  boundTermIds: string[];
};

async function toVisibleGroups(
  groups: GroupRow[],
  archiveContext: GroupArchiveContext,
  request?: Request,
): Promise<VisibleGroup[]> {
  const dynamicQueries = groups.flatMap((g) =>
    g.type === "Dynamic" && g.dynamicQuery ? [g.dynamicQuery] : [],
  );
  const members = await resolveDynamicQueries(dynamicQueries, { request });
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    type: g.type,
    dynamicQuery: g.dynamicQuery,
    systemKey: g.systemKey,
    memberIds:
      g.type === "Static" ? g.staticMemberIds : g.dynamicQuery ? (members.get(g.dynamicQuery) ?? []) : [],
    archived: isGroupArchived(g, archiveContext),
    archivedAt: g.archivedAt ? g.archivedAt.toISOString() : null,
    boundTermIds: g.boundTermIds,
  }));
}

// Derives which group definitions a user belongs to, WITHOUT resolving each
// group's member list. Shared core of listVisibleGroupIdsForUser (hot path,
// ids only) and listVisibleGroupsForUser (full shape, resolves memberIds).
//
// Perf optimisation (vs. the old resolveAllGroups().filter() path):
// Instead of resolving EVERY group's member list (each Dynamic group fires
// 1–5 DB queries → O(groups × sub-queries) fan-out), we:
//   1. Fetch all group definitions (one query).
//   2. Fetch the user's own assignment data in one parallel batch.
//   3. For each Dynamic group, derive membership from the user's data — no
//      per-group queries.
//
// The resulting set of groups is IDENTICAL to the old approach:
//   resolveAllGroups() calls the exact same per-kind resolvers; here we
//   reproduce the same predicate per kind but inverted (is-this-user-in
//   rather than who-is-in), using the same DB tables and the same fields.
// The only observable difference is performance.
async function deriveUserGroups(userId: string, request?: Request) {
  // Fetch group definitions + terms in parallel (terms needed for archive state
  // and for resolving "term:<id>" dynamic queries).
  const [groups, terms, coreCycleTermIds] = await Promise.all([
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
    getActiveCoreCycleTermIds(request),
  ]);

  const termEndById = new Map(terms.map((t) => [t.id, t.endDate]));
  const now = new Date();

  // Collect all the unique dynamic query kinds and their IDs so we can
  // build the membership data in a single batch of parallel queries.
  const termIds = new Set<string>();
  const projectIds = new Set<string>();
  const domainIds = new Set<string>();
  const offeringIds = new Set<string>();
  let needsCore = false;
  let needsHiring = false;
  let needsMentors = false;
  let needsAlumni = false;

  for (const g of groups) {
    if (g.type !== "Dynamic" || !g.dynamicQuery) continue;
    const [kind, id] = g.dynamicQuery.split(":", 2);
    switch (kind) {
      case "term":     if (id) termIds.add(id);     break;
      case "project":  if (id) projectIds.add(id);  break;
      case "domain":   if (id) domainIds.add(id);   break;
      case "offering": if (id) offeringIds.add(id); break;
      case "core":    needsCore = true;    break;
      case "hiring":  needsHiring = true;  break;
      case "mentors": needsMentors = true; break;
      case "alumni":  needsAlumni = true;  break;
    }
  }

  // One parallel batch for all the user's relevant assignment data.
  const [
    userProjectAssignments,
    userCoreAssignments,
    userInstructorAssignments,
    userMentorshipMentee,
    userMentorshipMentor,
    userDomainEligibility,
    userEducationApps,
    userRow,
    userDomainLeads,
    userReviewers,
    userInterviewers,
  ] = await Promise.all([
    termIds.size > 0 || projectIds.size > 0
      ? prisma.projectAssignment.findMany({
          where: { userId },
          select: { termId: true, projectId: true },
        })
      : Promise.resolve([] as { termId: string; projectId: string }[]),
    termIds.size > 0 || needsCore || needsHiring || needsMentors
      ? prisma.coreAssignment.findMany({
          where: { userId },
          select: { termId: true },
        })
      : Promise.resolve([] as { termId: string }[]),
    termIds.size > 0
      ? prisma.instructorAssignment.findMany({
          where: { userId },
          select: { termId: true },
        })
      : Promise.resolve([] as { termId: string }[]),
    termIds.size > 0
      ? prisma.mentorshipPair.findMany({
          where: { menteeUserId: userId },
          select: { termId: true },
        })
      : Promise.resolve([] as { termId: string }[]),
    termIds.size > 0
      ? prisma.mentorshipPair.findMany({
          where: { mentorUserId: userId },
          select: { termId: true },
        })
      : Promise.resolve([] as { termId: string }[]),
    domainIds.size > 0
      ? prisma.domainEligibility.findMany({
          where: { userId },
          select: { domainId: true },
        })
      : Promise.resolve([] as { domainId: string }[]),
    offeringIds.size > 0
      ? prisma.educationApplication.findMany({
          where: { applicantUserId: userId, status: "Approved" },
          select: { offeringId: true },
        })
      : Promise.resolve([] as { offeringId: string }[]),
    needsAlumni || needsHiring || domainIds.size > 0
      ? prisma.user.findUnique({
          where: { id: userId },
          // daliMember presence mirrors resolveAlumni's `daliMember: { isNot: null }`
          // gate — Alumni status alone must not admit a non-DALIMember to the group.
          // Domain groups need the same row for the inverse test (Active only).
          select: { membershipStatus: true, daliMember: { select: { userId: true } } },
        })
      : Promise.resolve(null),
    needsHiring
      ? prisma.domainLeadAssignment.findMany({
          where: { userId },
          select: { id: true },
          take: 1,
        })
      : Promise.resolve([] as { id: string }[]),
    needsHiring
      ? prisma.cycleReviewer.findMany({
          where: { userId },
          select: { id: true },
          take: 1,
        })
      : Promise.resolve([] as { id: string }[]),
    needsHiring
      ? prisma.cycleInterviewer.findMany({
          where: { userId },
          select: { id: true },
          take: 1,
        })
      : Promise.resolve([] as { id: string }[]),
  ]);

  // Derive the current term for project group membership (project groups are
  // current-term-scoped, matching resolveProjectMembers).
  const currentTermRow = await currentTerm(request);

  // Build lookup sets for O(1) membership tests.
  const userTermIds = new Set<string>();
  for (const r of userProjectAssignments)  userTermIds.add(r.termId);
  for (const r of userCoreAssignments)     userTermIds.add(r.termId);
  for (const r of userInstructorAssignments) userTermIds.add(r.termId);
  for (const r of userMentorshipMentee)    userTermIds.add(r.termId);
  for (const r of userMentorshipMentor)    userTermIds.add(r.termId);

  const userCurrentProjectIds = new Set<string>();
  if (currentTermRow) {
    for (const r of userProjectAssignments) {
      if (r.termId === currentTermRow.id) userCurrentProjectIds.add(r.projectId);
    }
  }

  const userDomainIds = new Set(userDomainEligibility.map((r) => r.domainId));
  const userOfferingIds = new Set(userEducationApps.map((r) => r.offeringId));

  const coreCycleTermIdSet = new Set(coreCycleTermIds);
  const isInCore = userCoreAssignments.some((r) => coreCycleTermIdSet.has(r.termId));
  const isAlumni = userRow?.membershipStatus === "Alumni" && userRow.daliMember != null;
  // Mirrors resolveDomainMembers' `user: ACTIVE_LAB_MEMBER_WHERE` gate.
  const isActiveLabMember =
    userRow?.membershipStatus === "Active" && userRow.daliMember != null;
  const isInHiring =
    isInCore ||
    userDomainLeads.length > 0 ||
    userReviewers.length > 0 ||
    userInterviewers.length > 0;
  // Core plus the per-user lab-mentor predicate: the inverse of resolveMentorMembers.
  const isInMentors =
    needsMentors && (isInCore || (await isLabMentor(userId, currentTermRow?.id, request)));

  // Collect the group definitions the user belongs to, using the in-memory
  // data — zero additional queries. memberIds are NOT resolved here; the two
  // public entry points below decide whether to pay for that.
  const memberOf: typeof groups = [];
  for (const g of groups) {
    let isMember: boolean;
    if (g.type === "Static") {
      isMember = g.staticMemberIds.includes(userId);
    } else {
      if (!g.dynamicQuery) {
        isMember = false;
      } else {
        const [kind, id] = g.dynamicQuery.split(":", 2);
        switch (kind) {
          case "term":     isMember = id ? userTermIds.has(id) : false; break;
          case "project":  isMember = id ? userCurrentProjectIds.has(id) : false; break;
          case "domain":   isMember = id ? isActiveLabMember && userDomainIds.has(id) : false; break;
          case "offering": isMember = id ? userOfferingIds.has(id) : false; break;
          case "core":     isMember = isInCore; break;
          case "hiring":   isMember = isInHiring; break;
          case "mentors":  isMember = isInMentors; break;
          case "alumni":   isMember = isAlumni; break;
          default:         isMember = false; break;
        }
      }
    }
    if (isMember) memberOf.push(g);
  }
  return { memberOf, termEndById, now };
}

// The groups a user belongs to as {id, archivedAt} only — no memberIds
// resolved. This is the hot path: getPageAccess/groupIdsForUser call it once
// per navigation and need only the ids (to match PageShare rows). Resolving the
// full member list of every group the user is in would be pure waste here,
// since the caller immediately discards memberIds.
export async function listVisibleGroupIdsForUser(
  userId: string,
  request?: Request,
): Promise<{ id: string; archivedAt: Date | null }[]> {
  const { memberOf } = await deriveUserGroups(userId, request);
  return memberOf.map((g) => ({ id: g.id, archivedAt: g.archivedAt }));
}

// The full VisibleGroup shape (members + derived archive state) for every group
// the user belongs to. Resolving memberIds costs several reads per kind of
// group the user is in — use it only where the member list is actually consumed (e.g. the group picker showing who's in each
// group). Permission checks that only need the ids must use
// listVisibleGroupIdsForUser instead.
export async function listVisibleGroupsForUser(
  userId: string,
  request?: Request,
): Promise<VisibleGroup[]> {
  const [{ memberOf }, archiveContext] = await Promise.all([
    deriveUserGroups(userId, request),
    loadGroupArchiveContext(),
  ]);
  return toVisibleGroups(memberOf, archiveContext, request);
}

/** The non-archived groups a user belongs to, without resolving anyone's member list. */
export async function listActiveGroupsForUser(
  userId: string,
  request?: Request,
): Promise<{ id: string; name: string; systemKey: string | null }[]> {
  const [{ memberOf }, archiveContext] = await Promise.all([
    deriveUserGroups(userId, request),
    loadGroupArchiveContext(),
  ]);
  return memberOf
    .filter((g) => !isGroupArchived(g, archiveContext))
    .map((g) => ({ id: g.id, name: g.name, systemKey: g.systemKey }));
}

export async function listActiveGroupNamesForUser(
  userId: string,
  request?: Request,
): Promise<string[]> {
  return (await listActiveGroupsForUser(userId, request)).map((g) => g.name);
}

// Returns every group, unfiltered. For the Groups management page, where a
// Core/Admin user manages groups they may not belong to — so a group created
// without adding yourself still shows up.
export async function listAllGroups(request?: Request): Promise<VisibleGroup[]> {
  return resolveAllGroups(request);
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

export async function ensureOfferingGroup(offeringId: string, title: string) {
  const systemKey = `offering:${offeringId}`;
  await prisma.groupDefinition.upsert({
    where: { systemKey },
    update: { name: `Offering ${title}` },
    create: {
      name: `Offering ${title}`,
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

/** Whether a group is the Core system group — the one whose meetings are Core
 *  meetings by construction. */
export async function isCoreGroup(groupId: string): Promise<boolean> {
  const group = await prisma.groupDefinition.findUnique({
    where: { id: groupId },
    select: { systemKey: true },
  });
  return group?.systemKey === "core";
}

export async function ensureHiringGroup() {
  await prisma.groupDefinition.upsert({
    where: { systemKey: "hiring" },
    update: {},
    create: {
      name: "Hiring team",
      type: "Dynamic",
      dynamicQuery: "hiring",
      systemKey: "hiring",
    },
  });
}

export async function ensureMentorsGroup() {
  await prisma.groupDefinition.upsert({
    where: { systemKey: "mentors" },
    update: {},
    create: {
      name: "Mentors",
      type: "Dynamic",
      dynamicQuery: "mentors",
      systemKey: "mentors",
    },
  });
}

export async function ensureAlumniGroup() {
  await prisma.groupDefinition.upsert({
    where: { systemKey: "alumni" },
    update: {},
    create: {
      name: "Alumni",
      type: "Dynamic",
      dynamicQuery: "alumni",
      systemKey: "alumni",
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
    ensureHiringGroup(),
    ensureMentorsGroup(),
    ensureAlumniGroup(),
    ...terms.map((t) => ensureTermGroup(t.id, t.code)),
    ...projects.map((p) => ensureProjectGroup(p.id, p.name)),
    ...domains.map((d) => ensureDomainGroup(d.id, d.displayName)),
  ]);
}
