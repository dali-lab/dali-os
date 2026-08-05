// MCP tool: list_mentor_notes — filterable list of mentor notes.
// Scope: mcp:read. Visibility: mentor/Core only (mentees are explicitly excluded).
// Mirrors the logic in api.mentorship.notes.ts GET handler.

import { prisma } from "~/lib/db";
import { canViewMentorship, mentorNoteWhere } from "~/mentorship/lib/visibility";
import { startOfWeekUTC } from "~/mentorship/lib/week";
import type { McpCtx, McpTool } from "../../registry";
import { McpForbiddenError } from "../../registry";

export const LIST_MENTOR_NOTES_TOOL = {
  name: "list_mentor_notes",
  description:
    "List mentor notes the caller can see. Mentors see their own notes plus notes in domains they mentor; Core sees all. Mentees are never granted access. All filters are optional and AND-combined.",
  inputSchema: {
    type: "object" as const,
    properties: {
      mentorId: { type: "string", description: "Filter by mentor user id." },
      menteeId: { type: "string", description: "Filter by mentee user id." },
      projectId: { type: "string", description: "Filter by project id." },
      termId: { type: "string", description: "Filter by term id." },
      domainId: { type: "string", description: "Filter by domain id." },
      weekOf: {
        type: "string",
        description:
          "Filter by week (yyyy-mm-dd). Collapsed to the Monday-UTC start of that ISO week.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListMentorNotes(
  callerId: string,
  input: {
    mentorId?: string;
    menteeId?: string;
    projectId?: string;
    termId?: string;
    domainId?: string;
    weekOf?: string;
  },
): Promise<unknown> {
  if (!(await canViewMentorship(callerId))) {
    throw new McpForbiddenError("Only lab mentors and Core members can list mentor notes");
  }

  const filters: Record<string, unknown> = {};
  if (input.mentorId) filters.mentorId = input.mentorId;
  if (input.menteeId) filters.menteeId = input.menteeId;
  if (input.projectId) filters.projectId = input.projectId;
  if (input.termId) filters.termId = input.termId;
  if (input.domainId) filters.domainId = input.domainId;
  if (input.weekOf) filters.weekOf = startOfWeekUTC(input.weekOf);

  const scope = await mentorNoteWhere(callerId);
  const notes = await prisma.mentorNote.findMany({
    where: { AND: [scope, filters] },
    orderBy: [{ weekOf: "desc" }, { updatedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      mentorId: true,
      menteeId: true,
      projectId: true,
      termId: true,
      domainId: true,
      weekOf: true,
      vibe: true,
      updatedAt: true,
      mentor: { select: { id: true, firstName: true, lastName: true } },
      mentee: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const projectIds = [...new Set(notes.map((n) => n.projectId))];
  const termIds = [...new Set(notes.map((n) => n.termId))];
  const domainIds = [...new Set(notes.map((n) => n.domainId))];
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
    notes: notes.map((n) => ({
      id: n.id,
      weekOf: n.weekOf.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      vibe: n.vibe,
      mentor: n.mentor,
      mentee: n.mentee,
      project: projectMap.get(n.projectId) ?? { id: n.projectId, name: "Unknown" },
      term: termMap.get(n.termId) ?? { id: n.termId, code: "?" },
      domain:
        domainMap.get(n.domainId) ?? { id: n.domainId, code: "?", displayName: "Unknown" },
    })),
  };
}

export const LIST_MENTOR_NOTES: McpTool = {
  def: LIST_MENTOR_NOTES_TOOL,
  run: (ctx: McpCtx, args) => runListMentorNotes(ctx.user.id, args as Parameters<typeof runListMentorNotes>[1]),
};
