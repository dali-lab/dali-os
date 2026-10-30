// MCP tool: list_mentorship_pairs — filterable list of mentor–mentee pairs.
// Scope: mcp:read. Visibility: mentor/Core only (mentees are explicitly excluded).
// Mirrors the logic in api.mentorship.pairs.ts GET handler.

import { prisma } from "~/lib/db.server";
import { canViewMentorship, mentorshipPairWhere } from "~/mentorship/lib/visibility";
import type { McpCtx, McpTool } from "../../registry";
import { McpForbiddenError } from "../../registry";
import { keysetPage, keysetWindow, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const LIST_MENTORSHIP_PAIRS_TOOL = {
  name: "list_mentorship_pairs",
  description:
    "List mentorship pairs the caller can see. Every lab mentor (and Core) sees all pairs lab-wide. All filters are optional and AND-combined. Ordered by term, then id. Pass page.nextCursor as cursor to read the next page until page.hasMore is false.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", description: "Filter by project id." },
      termId: { type: "string", description: "Filter by term id." },
      mentorUserId: { type: "string", description: "Filter by mentor user id." },
      menteeUserId: { type: "string", description: "Filter by mentee user id." },
      ...pageProps(PAGE_LIMITS),
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListMentorshipPairs(
  callerId: string,
  input: PageArgs & {
    projectId?: string;
    termId?: string;
    mentorUserId?: string;
    menteeUserId?: string;
  },
): Promise<unknown> {
  if (!(await canViewMentorship(callerId))) {
    throw new McpForbiddenError("Only lab mentors and Core members can list mentorship pairs");
  }

  const filters: Record<string, unknown> = {};
  if (input.projectId) filters.projectId = input.projectId;
  if (input.termId) filters.termId = input.termId;
  if (input.mentorUserId) filters.mentorUserId = input.mentorUserId;
  if (input.menteeUserId) filters.menteeUserId = input.menteeUserId;

  const scope = await mentorshipPairWhere(callerId);
  const window = keysetWindow(input, PAGE_LIMITS, [{ field: "termId", direction: "asc", type: "string" }], "asc");
  const fetched = await prisma.mentorshipPair.findMany({
    where: { AND: [scope, filters, window.where] },
    orderBy: window.orderBy,
    take: window.take,
    select: {
      id: true,
      projectId: true,
      termId: true,
      domainId: true,
      mentor: { select: { id: true, firstName: true, lastName: true } },
      mentee: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  const { rows: pairs, page } = keysetPage(fetched, window);

  const projectIds = [...new Set(pairs.map((p) => p.projectId))];
  const termIds = [...new Set(pairs.map((p) => p.termId))];
  const domainIds = [...new Set(pairs.map((p) => p.domainId))];
  const [projects, terms, domains] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    }),
    prisma.term.findMany({
      where: { id: { in: termIds } },
      select: { id: true, code: true },
    }),
    prisma.domain.findMany({
      where: { id: { in: domainIds } },
      select: { id: true, code: true, displayName: true },
    }),
  ]);
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const termMap = new Map(terms.map((t) => [t.id, t]));
  const domainMap = new Map(domains.map((d) => [d.id, d]));

  return {
    page,
    pairs: pairs.map((p) => ({
      id: p.id,
      mentor: p.mentor,
      mentee: p.mentee,
      project: projectMap.get(p.projectId) ?? { id: p.projectId, name: "Unknown" },
      term: termMap.get(p.termId) ?? { id: p.termId, code: "?" },
      domain:
        domainMap.get(p.domainId) ?? { id: p.domainId, code: "?", displayName: "Unknown" },
    })),
  };
}

export const LIST_MENTORSHIP_PAIRS: McpTool = {
  def: LIST_MENTORSHIP_PAIRS_TOOL,
  run: (ctx: McpCtx, args) => runListMentorshipPairs(ctx.user.id, args as Parameters<typeof runListMentorshipPairs>[1]),
};
