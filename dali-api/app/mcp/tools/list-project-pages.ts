// MCP `list_project_pages` — workspace page tree for a project. Returns
// top-level pages with their immediate children (2-level cap, matching
// schema invariant). Excludes archived pages by default.

import { prisma } from "~/lib/db";

export const LIST_PROJECT_PAGES_TOOL = {
  name: "list_project_pages",
  description:
    "List the page tree for a project's workspace (overview, PRD, retros, free-form docs). Excludes archived pages. Includes the project's Overview and PRD page ids on the project itself.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      includeArchived: { type: "boolean" },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { projectId: string; includeArchived?: boolean };

export class ListProjectPagesError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ListProjectPagesError";
  }
}

export async function runListProjectPages(_callerId: string, input: Input) {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, overviewPageId: true, prdPageId: true },
  });
  if (!project) throw new ListProjectPagesError("Project not found", 404);

  const pages = await prisma.page.findMany({
    where: {
      workspaceType: "Project",
      workspaceId: input.projectId,
      ...(input.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ parentPageId: "asc" }, { position: "asc" }],
    select: {
      id: true,
      parentPageId: true,
      title: true,
      kind: true,
      iconEmoji: true,
      position: true,
      archivedAt: true,
    },
  });

  type Node = {
    id: string;
    title: string;
    kind: string;
    iconEmoji: string | null;
    position: number;
    archivedAt: string | null;
    children: Node[];
  };

  const byParent = new Map<string | null, Node[]>();
  for (const p of pages) {
    const node: Node = {
      id: p.id,
      title: p.title,
      kind: p.kind,
      iconEmoji: p.iconEmoji,
      position: p.position,
      archivedAt: p.archivedAt?.toISOString() ?? null,
      children: [],
    };
    const key = p.parentPageId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(node);
  }
  function attach(node: Node) {
    node.children = byParent.get(node.id) ?? [];
  }
  const roots = byParent.get(null) ?? [];
  for (const root of roots) {
    attach(root);
    for (const child of root.children) attach(child);
  }

  return {
    overviewPageId: project.overviewPageId,
    prdPageId: project.prdPageId,
    pages: roots,
  };
}
