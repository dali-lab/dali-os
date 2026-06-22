import type { PrismaClient } from "~/generated/prisma/client";
import { fullName } from "~/lib/display";

// Per-entity LOCAL connections graph, built entirely from existing FK/join
// tables. This is deliberately NOT a global graph: fan-out is capped per edge
// type and overall, depth is hard-capped at 2 (default 1), so the result is
// always a small, readable neighborhood rather than a lab-wide hairball.
//
// No new data exposure: every edge maps to a join row a viewer could already
// see on the source entity's detail page. Role gating lives in the loaders
// (auth.ts / roles.ts), not here — see PR-09 plan.

export type EntityType = "project" | "user" | "domain";

export type NodeType =
  | "project"
  | "user"
  | "domain"
  | "term"
  | "partner"
  | "epic"
  | "sprint"
  | "task"
  | "tag";

export type EdgeType =
  | "declares_domain"
  | "runs_in_term"
  | "partnered_with"
  | "assigned_to"
  | "staffed_on"
  | "mentors"
  | "eligible_in"
  | "assigned_task"
  | "requests_role"
  | "contains"
  | "tagged";

export interface ConnNode {
  id: string;
  type: NodeType;
  label: string;
  /** true for the entity the view is centered on */
  isFocus?: boolean;
  /** route to that entity's own connections view (only for re-centerable types) */
  href?: string;
}

export interface ConnEdge {
  source: string; // ConnNode.id
  target: string; // ConnNode.id
  type: EdgeType;
  /** edge-type-specific context: level / termCode / status / slots, etc. */
  meta?: Record<string, string | number | null>;
}

export interface ConnectionsResult {
  focus: ConnNode;
  nodes: ConnNode[]; // includes focus; de-duped by id
  edges: ConnEdge[];
  /** true if any edge type hit its cap (UI shows "+ more") */
  truncated: boolean;
}

export interface BuildConnectionsOpts {
  depth?: 1 | 2; // default 1; hard-capped at 2
  maxNodes?: number; // default 120
  limitPerEdgeType?: number; // default 25
  includeTags?: boolean; // default false
  termId?: string; // optional: scope assignment/mentor edges to one term
}

const DEFAULTS = {
  depth: 1 as 1 | 2,
  maxNodes: 120,
  limitPerEdgeType: 25,
  includeTags: false,
};

type SubOpts = { limitPerEdgeType: number; includeTags: boolean };

// A namespaced id keeps nodes of different types from colliding when a raw
// id happens to repeat (cuids won't, but term codes / synthetic ids might).
function nodeId(type: NodeType, rawId: string): string {
  return `${type}:${rawId}`;
}

function hrefFor(type: NodeType, rawId: string): string | undefined {
  // Only the three re-centerable entity types get a connections route.
  if (type === "project" || type === "user" || type === "domain") {
    return `/connections/${type}/${rawId}`;
  }
  return undefined;
}

// Accumulator that enforces de-dup (by namespaced id) and the maxNodes cap,
// and tracks whether any per-edge-type cap was hit.
class GraphBuilder {
  private nodeMap = new Map<string, ConnNode>();
  private edgeKeys = new Set<string>();
  edges: ConnEdge[] = [];
  truncated = false;
  readonly limitPerEdgeType: number;
  readonly maxNodes: number;

  constructor(limitPerEdgeType: number, maxNodes: number) {
    this.limitPerEdgeType = limitPerEdgeType;
    this.maxNodes = maxNodes;
  }

  addNode(type: NodeType, rawId: string, label: string, isFocus = false): string {
    const id = nodeId(type, rawId);
    const existing = this.nodeMap.get(id);
    if (existing) {
      if (isFocus) existing.isFocus = true;
      return id;
    }
    // maxNodes cap: the focus node is always admitted; neighbors past the cap
    // are dropped and flagged.
    if (!isFocus && this.nodeMap.size >= this.maxNodes) {
      this.truncated = true;
      return id;
    }
    const href = hrefFor(type, rawId);
    this.nodeMap.set(id, {
      id,
      type,
      label,
      ...(isFocus ? { isFocus: true } : {}),
      ...(href ? { href } : {}),
    });
    return id;
  }

  addEdge(
    sourceId: string,
    targetId: string,
    type: EdgeType,
    meta?: ConnEdge["meta"],
  ): void {
    // Skip edges whose endpoints were dropped by the node cap.
    if (!this.nodeMap.has(sourceId) || !this.nodeMap.has(targetId)) return;
    // De-dup identical (source, target, type) edges (e.g. a neighbor reached
    // twice). Distinct meta is intentionally collapsed — the Related list
    // carries the fuller per-row detail.
    const key = `${sourceId}|${targetId}|${type}`;
    if (this.edgeKeys.has(key)) return;
    this.edgeKeys.add(key);
    this.edges.push({ source: sourceId, target: targetId, type, ...(meta ? { meta } : {}) });
  }

  /** Apply the per-edge-type fan-out cap to a row set, flagging truncation. */
  cap<T>(rows: T[]): T[] {
    if (rows.length > this.limitPerEdgeType) {
      this.truncated = true;
      return rows.slice(0, this.limitPerEdgeType);
    }
    return rows;
  }

  result(focusId: string): ConnectionsResult {
    const focus = this.nodeMap.get(focusId)!;
    return {
      focus,
      nodes: Array.from(this.nodeMap.values()),
      edges: this.edges,
      truncated: this.truncated,
    };
  }
}

function userLabel(u: { firstName: string | null; lastName: string | null }): string {
  return fullName(u) || "Member";
}

function domainLabel(d: { displayName: string | null; name: string | null }): string {
  return d.displayName || d.name || "Domain";
}

const USER_SELECT = { id: true, firstName: true, lastName: true } as const;
const DOMAIN_SELECT = { id: true, displayName: true, name: true } as const;

// ─── project ─────────────────────────────────────────────────────────────────

async function buildProject(
  prisma: PrismaClient,
  g: GraphBuilder,
  projectId: string,
  termId: string | undefined,
  opts: SubOpts,
): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) return null;
  const focusId = g.addNode("project", project.id, project.name, true);

  const assignmentWhere = termId ? { projectId, termId } : { projectId };
  const mentorWhere = termId ? { projectId, termId } : { projectId };

  const [domains, terms, partners, assignments, mentorships, roleRequests, epics, sprints, tasks] =
    await Promise.all([
      prisma.projectDomain.findMany({
        where: { projectId },
        select: { domain: { select: DOMAIN_SELECT } },
      }),
      prisma.projectTerm.findMany({
        where: { projectId },
        select: { term: { select: { id: true, code: true } } },
      }),
      prisma.projectPartner.findMany({
        where: { projectId },
        select: {
          partnerOrg: { select: { id: true, name: true } },
          startedAt: true,
          endedAt: true,
        },
      }),
      prisma.projectAssignment.findMany({
        where: assignmentWhere,
        select: {
          level: true,
          user: { select: USER_SELECT },
          term: { select: { code: true } },
        },
      }),
      prisma.mentorshipPair.findMany({
        where: mentorWhere,
        select: {
          mentor: { select: USER_SELECT },
          mentee: { select: USER_SELECT },
          term: { select: { code: true } },
          domain: { select: DOMAIN_SELECT },
        },
      }),
      prisma.projectRoleRequest.findMany({
        where: termId ? { projectId, termId } : { projectId },
        select: {
          level: true,
          slots: true,
          domain: { select: DOMAIN_SELECT },
          term: { select: { code: true } },
        },
      }),
      prisma.epic.findMany({ where: { projectId }, select: { id: true, title: true } }),
      prisma.sprint.findMany({ where: { projectId }, select: { id: true, name: true } }),
      prisma.task.findMany({ where: { projectId }, select: { id: true, title: true } }),
    ]);

  for (const row of g.cap(domains)) {
    const n = g.addNode("domain", row.domain.id, domainLabel(row.domain));
    g.addEdge(focusId, n, "declares_domain");
  }
  for (const row of g.cap(terms)) {
    const n = g.addNode("term", row.term.id, row.term.code);
    g.addEdge(focusId, n, "runs_in_term");
  }
  for (const row of g.cap(partners)) {
    const n = g.addNode("partner", row.partnerOrg.id, row.partnerOrg.name);
    g.addEdge(focusId, n, "partnered_with", {
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    });
  }
  for (const row of g.cap(assignments)) {
    const n = g.addNode("user", row.user.id, userLabel(row.user));
    g.addEdge(n, focusId, "assigned_to", { level: row.level, termCode: row.term.code });
  }
  for (const row of g.cap(mentorships)) {
    const mentor = g.addNode("user", row.mentor.id, userLabel(row.mentor));
    const mentee = g.addNode("user", row.mentee.id, userLabel(row.mentee));
    g.addEdge(mentor, mentee, "mentors", {
      termCode: row.term.code,
      domain: domainLabel(row.domain),
    });
  }
  for (const row of g.cap(roleRequests)) {
    const n = g.addNode("domain", row.domain.id, domainLabel(row.domain));
    g.addEdge(focusId, n, "requests_role", {
      level: row.level,
      slots: row.slots,
      termCode: row.term.code,
    });
  }
  for (const row of g.cap(epics)) {
    const n = g.addNode("epic", row.id, row.title);
    g.addEdge(focusId, n, "contains");
  }
  for (const row of g.cap(sprints)) {
    const n = g.addNode("sprint", row.id, row.name);
    g.addEdge(focusId, n, "contains");
  }
  for (const row of g.cap(tasks)) {
    const n = g.addNode("task", row.id, row.title);
    g.addEdge(focusId, n, "contains");
  }

  if (opts.includeTags) {
    await addProjectTags(prisma, g, focusId, projectId);
  }

  return focusId;
}

// ─── user ──────────────────────────────────────────────────────────────────

async function buildUser(
  prisma: PrismaClient,
  g: GraphBuilder,
  userId: string,
  termId: string | undefined,
): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: USER_SELECT,
  });
  if (!user) return null;
  const focusId = g.addNode("user", user.id, userLabel(user), true);

  const termScope = termId ? { termId } : {};

  const [eligibilities, assignments, staffings, mentorAs, menteeAs, taskAssignments] =
    await Promise.all([
      prisma.domainEligibility.findMany({
        where: { userId },
        select: { level: true, domain: { select: DOMAIN_SELECT } },
      }),
      prisma.projectAssignment.findMany({
        where: { userId, ...termScope },
        select: {
          level: true,
          project: { select: { id: true, name: true } },
          term: { select: { code: true } },
        },
      }),
      prisma.staffingAssignment.findMany({
        where: { userId, ...termScope },
        select: {
          projectId: true,
          level: true,
          status: true,
          term: { select: { code: true } },
        },
      }),
      prisma.mentorshipPair.findMany({
        where: { mentorUserId: userId, ...termScope },
        select: {
          mentee: { select: USER_SELECT },
          term: { select: { code: true } },
          domain: { select: DOMAIN_SELECT },
        },
      }),
      prisma.mentorshipPair.findMany({
        where: { menteeUserId: userId, ...termScope },
        select: {
          mentor: { select: USER_SELECT },
          term: { select: { code: true } },
          domain: { select: DOMAIN_SELECT },
        },
      }),
      prisma.taskAssignee.findMany({
        where: { userId },
        select: { task: { select: { id: true, title: true } } },
      }),
    ]);

  for (const row of g.cap(eligibilities)) {
    const n = g.addNode("domain", row.domain.id, domainLabel(row.domain));
    g.addEdge(focusId, n, "eligible_in", { level: row.level });
  }
  for (const row of g.cap(assignments)) {
    const n = g.addNode("project", row.project.id, row.project.name);
    g.addEdge(focusId, n, "assigned_to", { level: row.level, termCode: row.term.code });
  }
  // StaffingAssignment has no `project` relation (bare projectId field), so we
  // batch a single findMany to label the staffed projects rather than N+1.
  const cappedStaffings = g.cap(staffings);
  const staffProjectIds = Array.from(new Set(cappedStaffings.map((s) => s.projectId)));
  const staffProjects = staffProjectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: staffProjectIds } },
        select: { id: true, name: true },
      })
    : [];
  const staffProjectName = new Map(staffProjects.map((p) => [p.id, p.name]));
  for (const row of cappedStaffings) {
    const name = staffProjectName.get(row.projectId);
    if (!name) continue;
    const n = g.addNode("project", row.projectId, name);
    g.addEdge(focusId, n, "staffed_on", {
      level: row.level,
      status: row.status,
      termCode: row.term.code,
    });
  }
  for (const row of g.cap(mentorAs)) {
    const n = g.addNode("user", row.mentee.id, userLabel(row.mentee));
    g.addEdge(focusId, n, "mentors", {
      termCode: row.term.code,
      domain: domainLabel(row.domain),
    });
  }
  for (const row of g.cap(menteeAs)) {
    const n = g.addNode("user", row.mentor.id, userLabel(row.mentor));
    g.addEdge(n, focusId, "mentors", {
      termCode: row.term.code,
      domain: domainLabel(row.domain),
    });
  }
  for (const row of g.cap(taskAssignments)) {
    const n = g.addNode("task", row.task.id, row.task.title);
    g.addEdge(focusId, n, "assigned_task");
  }

  return focusId;
}

// ─── domain ──────────────────────────────────────────────────────────────────

async function buildDomain(
  prisma: PrismaClient,
  g: GraphBuilder,
  domainId: string,
  termId: string | undefined,
  opts: SubOpts,
): Promise<string | null> {
  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: DOMAIN_SELECT,
  });
  if (!domain) return null;
  const focusId = g.addNode("domain", domain.id, domainLabel(domain), true);

  const [projectDomains, eligibilities, roleRequests] = await Promise.all([
    prisma.projectDomain.findMany({
      where: { domainId },
      select: { project: { select: { id: true, name: true } } },
    }),
    prisma.domainEligibility.findMany({
      where: { domainId },
      select: { level: true, user: { select: USER_SELECT } },
    }),
    prisma.projectRoleRequest.findMany({
      where: termId ? { domainId, termId } : { domainId },
      select: {
        level: true,
        slots: true,
        project: { select: { id: true, name: true } },
        term: { select: { code: true } },
      },
    }),
  ]);

  for (const row of g.cap(projectDomains)) {
    const n = g.addNode("project", row.project.id, row.project.name);
    g.addEdge(n, focusId, "declares_domain");
  }
  for (const row of g.cap(eligibilities)) {
    const n = g.addNode("user", row.user.id, userLabel(row.user));
    g.addEdge(n, focusId, "eligible_in", { level: row.level });
  }
  for (const row of g.cap(roleRequests)) {
    const n = g.addNode("project", row.project.id, row.project.name);
    g.addEdge(n, focusId, "requests_role", {
      level: row.level,
      slots: row.slots,
      termCode: row.term.code,
    });
  }

  if (opts.includeTags) {
    await addDomainTags(prisma, g, focusId, domainId);
  }

  return focusId;
}

// ─── optional tag clustering ──────────────────────────────────────────────────

// Project files carry tags via ProjectFileTag → the project's files cluster
// under shared DocTags.
async function addProjectTags(
  prisma: PrismaClient,
  g: GraphBuilder,
  focusId: string,
  projectId: string,
): Promise<void> {
  const fileTags = await prisma.projectFileTag.findMany({
    where: { file: { projectId } },
    select: { tag: { select: { id: true, label: true } } },
  });
  for (const row of g.cap(fileTags)) {
    const n = g.addNode("tag", row.tag.id, row.tag.label);
    g.addEdge(focusId, n, "tagged");
  }
}

// A domain's tag cluster is derived from project files of projects that
// declare the domain — a loose association, kept behind includeTags.
async function addDomainTags(
  prisma: PrismaClient,
  g: GraphBuilder,
  focusId: string,
  domainId: string,
): Promise<void> {
  const fileTags = await prisma.projectFileTag.findMany({
    where: { file: { project: { domains: { some: { domainId } } } } },
    select: { tag: { select: { id: true, label: true } } },
  });
  for (const row of g.cap(fileTags)) {
    const n = g.addNode("tag", row.tag.id, row.tag.label);
    g.addEdge(focusId, n, "tagged");
  }
}

// ─── second-hop expansion ──────────────────────────────────────────────────

// Expand one extra hop from the entity neighbors already present, reusing the
// per-edge-type and maxNodes caps. Hard-capped at depth 2: we expand only the
// first-hop project/user/domain nodes and never recurse a third time.
async function expandSecondHop(
  prisma: PrismaClient,
  g: GraphBuilder,
  focusId: string,
  termId: string | undefined,
  opts: SubOpts,
): Promise<void> {
  // Snapshot the first-hop entity neighbors before we start adding more.
  const seen = new Set<string>();
  const targets: { type: EntityType; rawId: string }[] = [];
  for (const e of g.edges) {
    for (const id of [e.source, e.target]) {
      if (id === focusId || seen.has(id)) continue;
      seen.add(id);
      const idx = id.indexOf(":");
      const type = id.slice(0, idx);
      const rawId = id.slice(idx + 1);
      if ((type === "project" || type === "user" || type === "domain") && rawId) {
        targets.push({ type: type as EntityType, rawId });
      }
    }
  }

  for (const t of targets) {
    if (t.type === "project") await buildProject(prisma, g, t.rawId, termId, opts);
    else if (t.type === "user") await buildUser(prisma, g, t.rawId, termId);
    else await buildDomain(prisma, g, t.rawId, termId, opts);
  }
}

export async function buildConnections(
  prisma: PrismaClient,
  entityType: EntityType,
  id: string,
  opts: BuildConnectionsOpts = {},
): Promise<ConnectionsResult> {
  const depth = (opts.depth ?? DEFAULTS.depth) === 2 ? 2 : 1;
  const maxNodes = opts.maxNodes ?? DEFAULTS.maxNodes;
  const limitPerEdgeType = opts.limitPerEdgeType ?? DEFAULTS.limitPerEdgeType;
  const includeTags = opts.includeTags ?? DEFAULTS.includeTags;
  const termId = opts.termId;
  const subOpts: SubOpts = { limitPerEdgeType, includeTags };

  const g = new GraphBuilder(limitPerEdgeType, maxNodes);

  let focusId: string | null;
  switch (entityType) {
    case "project":
      focusId = await buildProject(prisma, g, id, termId, subOpts);
      break;
    case "user":
      focusId = await buildUser(prisma, g, id, termId);
      break;
    case "domain":
      focusId = await buildDomain(prisma, g, id, termId, subOpts);
      break;
  }

  if (!focusId) {
    throw new Response("Entity not found", { status: 404 });
  }

  if (depth === 2) {
    await expandSecondHop(prisma, g, focusId, termId, subOpts);
  }

  return g.result(focusId);
}
