// MCP tool: get_mentor_note — read one mentor note with normalized content.
// Scope: mcp:read. Visibility: mentor/Core only (mentees are explicitly excluded).
// Mirrors the logic in api.mentorship.notes.$id.ts GET handler.

import { prisma } from "~/lib/db";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { canViewMentorship, canViewMentorNote } from "~/mentorship/lib/visibility";
import type { McpCtx, McpTool } from "../../registry";
import { McpForbiddenError, McpNotFoundError } from "../../registry";

export const GET_MENTOR_NOTE_TOOL = {
  name: "get_mentor_note",
  description:
    "Read a single mentor note by id. Returns normalized block JSON content, vibe, and full metadata. Accessible to the note's author, same-domain mentors, or Core. Mentees are never granted access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: { type: "string", description: "MentorNote id." },
    },
    required: ["id"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runGetMentorNote(
  callerId: string,
  input: { id: string },
): Promise<unknown> {
  if (!(await canViewMentorship(callerId))) {
    throw new McpForbiddenError("Only lab mentors and Core members can read mentor notes");
  }

  const note = await prisma.mentorNote.findUnique({
    where: { id: input.id },
    select: {
      id: true,
      mentorId: true,
      menteeId: true,
      projectId: true,
      termId: true,
      domainId: true,
      weekOf: true,
      contentJson: true,
      vibe: true,
      updatedAt: true,
      mentor: { select: { id: true, firstName: true, lastName: true } },
      mentee: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!note) throw new McpNotFoundError(`Mentor note ${input.id} not found`);
  if (!(await canViewMentorNote(callerId, note))) {
    throw new McpForbiddenError("You don't have access to this mentor note");
  }

  const [project, term, domain] = await Promise.all([
    prisma.project.findUnique({
      where: { id: note.projectId },
      select: { id: true, name: true },
    }),
    prisma.term.findUnique({
      where: { id: note.termId },
      select: { id: true, code: true },
    }),
    prisma.domain.findUnique({
      where: { id: note.domainId },
      select: { id: true, code: true, displayName: true },
    }),
  ]);

  return {
    id: note.id,
    mentorId: note.mentorId,
    menteeId: note.menteeId,
    projectId: note.projectId,
    termId: note.termId,
    domainId: note.domainId,
    weekOf: note.weekOf.toISOString(),
    contentJson: ensureBlocks(note.contentJson),
    vibe: note.vibe,
    updatedAt: note.updatedAt.toISOString(),
    mentor: note.mentor,
    mentee: note.mentee,
    project,
    term,
    domain,
  };
}

export const GET_MENTOR_NOTE: McpTool = {
  def: GET_MENTOR_NOTE_TOOL,
  run: (ctx: McpCtx, args) => runGetMentorNote(ctx.user.id, args as Parameters<typeof runGetMentorNote>[1]),
};
