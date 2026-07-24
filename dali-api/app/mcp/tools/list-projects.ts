// MCP `list_projects` — the whole project directory, mirroring the web
// projects hub (requireAuth only: any member browses all projects, all
// statuses). Complements list_my_projects (staffing-scoped): this is how an
// agent discovers a project it isn't staffed on — e.g. Core targeting another
// team's hub for a Notion-export sync. `staffed` marks the caller's own
// projects so agents can tell the two sets apart.

import { prisma } from "~/lib/db";

export const LIST_PROJECTS_TOOL = {
  name: "list_projects",
  description:
    "List every project in the lab (id, name, status, terms, partner orgs) — the full directory, not just the caller's assignments. Use list_my_projects for staffed-on detail; get_project_overview to drill into one.",
  inputSchema: {
    type: "object" as const,
    properties: {
      status: {
        description: "Restrict to these statuses. Default: all (Active, Paused, Archived).",
        type: "array",
        items: { enum: ["Active", "Paused", "Archived"], type: "string" },
        maxItems: 3,
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { status?: ("Active" | "Paused" | "Archived")[] };

export async function runListProjects(callerId: string, input: Input) {
  const [projects, assignments] = await Promise.all([
    prisma.project.findMany({
      where: input.status?.length ? { status: { in: input.status } } : undefined,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        status: true,
        projectTerms: {
          select: { term: { select: { code: true, sortKey: true } } },
        },
        partners: {
          select: { partnerOrg: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.projectAssignment.findMany({
      where: { userId: callerId },
      select: { projectId: true },
    }),
  ]);
  const staffedIds = new Set(assignments.map((a) => a.projectId));

  return {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      termCodes: p.projectTerms
        .map((pt) => pt.term)
        .sort((a, b) => a.sortKey - b.sortKey)
        .map((t) => t.code),
      partnerOrgs: p.partners.map((x) => x.partnerOrg),
      staffed: staffedIds.has(p.id),
    })),
  };
}
