import type { PrismaClient } from "~/generated/prisma/client";
import { fullName } from "~/lib/display";

// Global lab graph, built entirely from existing FK/join tables — no schema
// change, no new data. Every edge maps to a join row already visible to a
// member somewhere in the app; the graph just unifies them into one
// force-directed, Obsidian-style view (see app/graph/routes/graph.tsx).
//
// The builder pulls each entity table and each join table with a narrow
// `select`, then assembles nodes + edges in memory. No N+1: one query per
// table, no per-row lookups.

export type NodeType =
  | "project"
  | "person"
  | "domain"
  | "term"
  | "partner"
  | "task"
  | "epic"
  | "sprint"
  | "document"
  | "file";

export type EdgeType =
  | "declares_domain" // project ─ domain   (ProjectDomain)
  | "runs_in_term" // project ─ term         (ProjectTerm)
  | "partnered_with" // project ─ partner     (ProjectPartner)
  | "assigned_to" // person ─ project        (ProjectAssignment)
  | "staffed_on" // person ─ project         (StaffingAssignment)
  | "mentors" // person ─ person             (MentorshipPair)
  | "eligible_in" // person ─ domain          (DomainEligibility)
  | "requests_role" // project ─ domain       (ProjectRoleRequest)
  | "assigned_task" // person ─ task          (TaskAssignee)
  | "task_in_epic" // task ─ epic             (Task.epicId)
  | "task_in_sprint" // task ─ sprint         (Task.sprintId)
  | "sprint_in_epic" // sprint ─ epic         (Sprint.epicId)
  | "epic_in_project" // epic ─ project        (Epic.projectId)
  | "sprint_in_project" // sprint ─ project    (Sprint.projectId)
  | "task_in_project" // task ─ project        (Task.projectId)
  | "doc_in_project" // document ─ project     (Page.workspaceId)
  | "file_in_project"; // file ─ project        (ProjectFile.projectId)

export interface GraphNode {
  /** namespaced id, e.g. "project:abc" — unique across types */
  id: string;
  type: NodeType;
  label: string;
  /** route to that entity's page, when one exists */
  href?: string;
}

export interface GraphEdge {
  source: string; // GraphNode.id
  target: string; // GraphNode.id
  type: EdgeType;
}

export interface GlobalGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface BuildGlobalGraphOpts {
  /** scope assignment / staffing / mentorship / role-request edges to one term */
  termId?: string;
}

// A namespaced id keeps nodes of different types from colliding if a raw id
// ever repeats across tables.
function nodeId(type: NodeType, rawId: string): string {
  return `${type}:${rawId}`;
}

function hrefFor(type: NodeType, rawId: string): string | undefined {
  switch (type) {
    case "project":
      return `/projects/${rawId}`;
    case "person":
      return `/members/${rawId}`;
    case "document":
      return `/documents/${rawId}`;
    case "file":
      return `/documents/file/${rawId}`;
    default:
      // domain / term / partner / task / epic / sprint have no standalone page.
      return undefined;
  }
}

// Accumulator that de-dups nodes (by namespaced id) and edges (by
// source|target|type), so a relation reached from two directions collapses to
// one drawn edge.
class GraphAccumulator {
  private nodeMap = new Map<string, GraphNode>();
  private edgeKeys = new Set<string>();
  edges: GraphEdge[] = [];

  addNode(type: NodeType, rawId: string, label: string): string {
    const id = nodeId(type, rawId);
    if (!this.nodeMap.has(id)) {
      const href = hrefFor(type, rawId);
      this.nodeMap.set(id, { id, type, label, ...(href ? { href } : {}) });
    }
    return id;
  }

  /** Add an edge only when both endpoints already exist as nodes. */
  addEdge(sourceId: string, targetId: string, type: EdgeType): void {
    if (!this.nodeMap.has(sourceId) || !this.nodeMap.has(targetId)) return;
    const key = `${sourceId}|${targetId}|${type}`;
    if (this.edgeKeys.has(key)) return;
    this.edgeKeys.add(key);
    this.edges.push({ source: sourceId, target: targetId, type });
  }

  has(type: NodeType, rawId: string): boolean {
    return this.nodeMap.has(nodeId(type, rawId));
  }

  result(): GlobalGraph {
    return { nodes: Array.from(this.nodeMap.values()), edges: this.edges };
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

export async function buildGlobalGraph(
  prisma: PrismaClient,
  opts: BuildGlobalGraphOpts = {},
): Promise<GlobalGraph> {
  const g = new GraphAccumulator();
  const termId = opts.termId;
  const termScope = termId ? { termId } : {};

  // ─── Entity tables (the nodes) ─────────────────────────────────────────────
  // People are lab members only (a DALIMember row exists) — applicants and
  // bare partner users are not lab entities and never appear.
  const [projects, people, domains, terms, partners, epics, sprints, tasks, documents, files] =
    await Promise.all([
      prisma.project.findMany({ select: { id: true, name: true } }),
      prisma.user.findMany({
        where: { daliMember: { isNot: null } },
        select: USER_SELECT,
      }),
      prisma.domain.findMany({ select: DOMAIN_SELECT }),
      prisma.term.findMany({ select: { id: true, code: true } }),
      prisma.partnerOrg.findMany({ select: { id: true, name: true } }),
      prisma.epic.findMany({ select: { id: true, title: true, projectId: true } }),
      prisma.sprint.findMany({
        select: { id: true, name: true, projectId: true, epicId: true },
      }),
      prisma.task.findMany({
        select: { id: true, title: true, projectId: true, epicId: true, sprintId: true },
      }),
      prisma.page.findMany({
        where: { workspaceType: "Project", archivedAt: null },
        select: { id: true, title: true, workspaceId: true },
      }),
      prisma.projectFile.findMany({
        where: { archivedAt: null },
        select: { id: true, title: true, projectId: true },
      }),
    ]);

  for (const p of projects) g.addNode("project", p.id, p.name);
  for (const u of people) g.addNode("person", u.id, userLabel(u));
  for (const d of domains) g.addNode("domain", d.id, domainLabel(d));
  for (const t of terms) g.addNode("term", t.id, t.code);
  for (const p of partners) g.addNode("partner", p.id, p.name);
  for (const e of epics) g.addNode("epic", e.id, e.title);
  for (const s of sprints) g.addNode("sprint", s.id, s.name);
  for (const t of tasks) g.addNode("task", t.id, t.title);
  for (const d of documents) g.addNode("document", d.id, d.title);
  for (const f of files) g.addNode("file", f.id, f.title);

  // ─── Join / FK tables (the edges) ──────────────────────────────────────────
  const [
    projectDomains,
    projectTerms,
    projectPartners,
    assignments,
    staffings,
    mentorships,
    eligibilities,
    roleRequests,
    taskAssignees,
  ] = await Promise.all([
    prisma.projectDomain.findMany({ select: { projectId: true, domainId: true } }),
    prisma.projectTerm.findMany({ select: { projectId: true, termId: true } }),
    prisma.projectPartner.findMany({ select: { projectId: true, partnerOrgId: true } }),
    prisma.projectAssignment.findMany({
      where: termScope,
      select: { userId: true, projectId: true },
    }),
    prisma.staffingAssignment.findMany({
      where: termScope,
      select: { userId: true, projectId: true },
    }),
    prisma.mentorshipPair.findMany({
      where: termScope,
      select: { mentorUserId: true, menteeUserId: true },
    }),
    prisma.domainEligibility.findMany({ select: { userId: true, domainId: true } }),
    prisma.projectRoleRequest.findMany({
      where: termScope,
      select: { projectId: true, domainId: true },
    }),
    prisma.taskAssignee.findMany({ select: { userId: true, taskId: true } }),
  ]);

  for (const r of projectDomains) {
    g.addEdge(nodeId("project", r.projectId), nodeId("domain", r.domainId), "declares_domain");
  }
  for (const r of projectTerms) {
    g.addEdge(nodeId("project", r.projectId), nodeId("term", r.termId), "runs_in_term");
  }
  for (const r of projectPartners) {
    g.addEdge(nodeId("project", r.projectId), nodeId("partner", r.partnerOrgId), "partnered_with");
  }
  for (const r of assignments) {
    g.addEdge(nodeId("person", r.userId), nodeId("project", r.projectId), "assigned_to");
  }
  for (const r of staffings) {
    g.addEdge(nodeId("person", r.userId), nodeId("project", r.projectId), "staffed_on");
  }
  for (const r of mentorships) {
    g.addEdge(nodeId("person", r.mentorUserId), nodeId("person", r.menteeUserId), "mentors");
  }
  for (const r of eligibilities) {
    g.addEdge(nodeId("person", r.userId), nodeId("domain", r.domainId), "eligible_in");
  }
  for (const r of roleRequests) {
    g.addEdge(nodeId("project", r.projectId), nodeId("domain", r.domainId), "requests_role");
  }
  for (const r of taskAssignees) {
    g.addEdge(nodeId("person", r.userId), nodeId("task", r.taskId), "assigned_task");
  }

  // Containment tree edges, derived from the FK columns already selected on
  // the entity tables above (no extra query). Each task links to its most
  // specific parent (sprint → epic → project) plus the project, so the work
  // hierarchy reads cleanly without a flat star of every task on the project.
  for (const e of epics) {
    g.addEdge(nodeId("epic", e.id), nodeId("project", e.projectId), "epic_in_project");
  }
  for (const s of sprints) {
    g.addEdge(nodeId("sprint", s.id), nodeId("project", s.projectId), "sprint_in_project");
    if (s.epicId) g.addEdge(nodeId("sprint", s.id), nodeId("epic", s.epicId), "sprint_in_epic");
  }
  for (const t of tasks) {
    if (t.sprintId) {
      g.addEdge(nodeId("task", t.id), nodeId("sprint", t.sprintId), "task_in_sprint");
    } else if (t.epicId) {
      g.addEdge(nodeId("task", t.id), nodeId("epic", t.epicId), "task_in_epic");
    } else {
      g.addEdge(nodeId("task", t.id), nodeId("project", t.projectId), "task_in_project");
    }
  }
  for (const f of files) {
    g.addEdge(nodeId("file", f.id), nodeId("project", f.projectId), "file_in_project");
  }
  for (const d of documents) {
    if (d.workspaceId) {
      g.addEdge(nodeId("document", d.id), nodeId("project", d.workspaceId), "doc_in_project");
    }
  }

  return g.result();
}
