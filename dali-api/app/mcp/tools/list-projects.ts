import { prisma } from "~/lib/db.server";
import { listMyProjects } from "~/projects/lib/my-projects.server";
import { offsetPage, offsetWindow, pageProps, type PageArgs } from "../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const LIST_PROJECTS_TOOL = {
  name: "list_projects",
  description:
    "List projects. Default: every project in the lab (id, name, status, terms, partner orgs, staffed flag), paged. With mine: only projects the caller is staffed on (any term), each with current-term role, current sprint and open task count, unpaged. Use get_project to drill into one.",
  inputSchema: {
    type: "object" as const,
    properties: {
      mine: {
        type: "boolean",
        description: "Only the caller's staffed projects, with current-term detail. Ignores status and paging.",
      },
      currentTermOnly: {
        type: "boolean",
        description: "mine only: limit to projects staffed for the current term. Default false.",
      },
      status: {
        description: "Restrict to these statuses. Default: all (Active, Paused, Archived). Ignored with mine.",
        type: "array",
        items: { enum: ["Active", "Paused", "Archived"], type: "string" },
        maxItems: 3,
      },
      ...pageProps(PAGE_LIMITS),
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = PageArgs & {
  mine?: boolean;
  currentTermOnly?: boolean;
  status?: ("Active" | "Paused" | "Archived")[];
};

export async function runListProjects(callerId: string, input: Input & { mine: true }): ReturnType<typeof listMyProjects>;
export async function runListProjects(callerId: string, input: Input & { mine?: false }): ReturnType<typeof listAllProjects>;
export async function runListProjects(
  callerId: string,
  input: Input,
): Promise<Awaited<ReturnType<typeof listMyProjects | typeof listAllProjects>>>;
export async function runListProjects(callerId: string, input: Input) {
  if (input.mine) return listMyProjects(callerId, { currentTermOnly: input.currentTermOnly });
  return listAllProjects(callerId, input);
}

async function listAllProjects(callerId: string, input: Input) {
  const window = offsetWindow(input, PAGE_LIMITS);
  const where = input.status?.length ? { status: { in: input.status } } : undefined;
  const [fetched, total, assignments] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: [{ status: "asc" }, { name: "asc" }, { id: "asc" }],
      skip: window.skip,
      take: window.take,
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
    prisma.project.count({ where }),
    prisma.projectAssignment.findMany({
      where: { userId: callerId },
      select: { projectId: true },
    }),
  ]);
  const staffedIds = new Set(assignments.map((a) => a.projectId));
  const { rows: projects, page } = offsetPage(fetched, window, total);

  return {
    page,
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
