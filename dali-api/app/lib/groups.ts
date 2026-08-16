import { prisma } from "~/lib/db";
import { currentTerm, getActiveCoreCycleTermIds } from "~/lib/roles";

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
    case "offering":
      return id ? resolveOfferingMembers(id) : [];
    case "core":
      return resolveCoreMembers();
    case "hiring":
      return resolveHiringMembers();
    case "alumni":
      return resolveAlumni();
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
async function resolveProjectMembers(projectId: string): Promise<string[]> {
  const term = await currentTerm();
  if (!term) return [];
  const rows = await prisma.projectAssignment.findMany({
    where: { projectId, termId: term.id },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((r) => r.userId);
}

// Members of an EducationOffering: users with an Approved application to that
// offering. "Approved" = the Education team accepted the application; it is the
// enrollment gate for both member-portal and Dartmouth-portal applicants.
async function resolveOfferingMembers(offeringId: string): Promise<string[]> {
  const rows = await prisma.educationApplication.findMany({
    where: { offeringId, status: "Approved" },
    select: { applicantUserId: true },
    distinct: ["applicantUserId"],
  });
  return rows.map((r) => r.applicantUserId);
}

async function resolveDomainMembers(domainId: string): Promise<string[]> {
  const rows = await prisma.domainEligibility.findMany({
    where: { domainId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
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

async function resolveCoreMembers(): Promise<string[]> {
  const cycleTermIds = await getActiveCoreCycleTermIds();
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
async function resolveHiringMembers(): Promise<string[]> {
  const [core, leads, reviewers, interviewers] = await Promise.all([
    resolveCoreMembers(),
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
    where: {
      daliMember: { isNot: null },
      membershipStatus: "Active",
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
export async function listVisibleGroupsForUser(
  userId: string,
  request?: Request,
): Promise<VisibleGroup[]> {
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
    termIds.size > 0 || needsCore || needsHiring
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
    needsAlumni || needsHiring
      ? prisma.user.findUnique({
          where: { id: userId },
          // daliMember presence mirrors resolveAlumni's `daliMember: { isNot: null }`
          // gate — Alumni status alone must not admit a non-DALIMember to the group.
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
  const isInHiring =
    isInCore ||
    userDomainLeads.length > 0 ||
    userReviewers.length > 0 ||
    userInterviewers.length > 0;

  // Now resolve each group using the in-memory data — zero additional queries.
  const result: VisibleGroup[] = [];
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
          case "domain":   isMember = id ? userDomainIds.has(id) : false; break;
          case "offering": isMember = id ? userOfferingIds.has(id) : false; break;
          case "core":     isMember = isInCore; break;
          case "hiring":   isMember = isInHiring; break;
          case "alumni":   isMember = isAlumni; break;
          default:         isMember = false; break;
        }
      }
    }
    if (!isMember) continue;

    // For the member list attached to the group shape (used by the group
    // picker to show who's in each group), we still need to resolve the full
    // memberIds. We do that lazily only for groups the user actually belongs
    // to — which is typically a small subset of all groups.
    let memberIds: string[];
    if (g.type === "Static") {
      memberIds = g.staticMemberIds;
    } else if (g.dynamicQuery) {
      memberIds = await resolveDynamicQuery(g.dynamicQuery);
    } else {
      memberIds = [];
    }

    result.push({
      id: g.id,
      name: g.name,
      type: g.type,
      dynamicQuery: g.dynamicQuery,
      systemKey: g.systemKey,
      memberIds,
      archived: isGroupArchived(g, termEndById, now),
      archivedAt: g.archivedAt ? g.archivedAt.toISOString() : null,
      boundTermIds: g.boundTermIds,
    });
  }
  return result;
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
    ensureAlumniGroup(),
    ...terms.map((t) => ensureTermGroup(t.id, t.code)),
    ...projects.map((p) => ensureProjectGroup(p.id, p.name)),
    ...domains.map((d) => ensureDomainGroup(d.id, d.displayName)),
  ]);
}
