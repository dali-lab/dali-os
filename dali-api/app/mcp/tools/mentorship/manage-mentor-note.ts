// MCP tool: manage_mentor_note — faceted write tool for mentor notes.
// Scope: mcp:write. Gated to mentor/Core on all actions.
//
// Actions:
//   upsert  — open-or-create a note for the caller as mentor (idempotent).
//             Seeds from the default template when creating. Returns {id, created}.
//   set_vibe — set or clear the vibe field (Good | Ok | Bad | null).
//              Caller must be the note's author or Core.
//   delete  — delete a note. Caller must be the note's author or Core.
//
// contentJson is a collaborative document (Hocuspocus-owned). The upsert seeds
// it from the template on creation but never overwrites it directly afterward —
// use the DocEditor to write. The vibe and metadata fields are plain columns.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { canViewMentorship } from "~/mentorship/lib/visibility";
import { startOfWeekUTC } from "~/mentorship/lib/week";
import type { McpCtx, McpTool } from "../../registry";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  requireForAction,
} from "../../registry";

const VIBES = ["Good", "Ok", "Bad"] as const;
type Vibe = (typeof VIBES)[number];

export const MANAGE_MENTOR_NOTE_TOOL = {
  name: "manage_mentor_note",
  description:
    "Create, update, or delete a mentor note. Action 'upsert' opens (or retrieves existing) a note for the caller as mentor for a given mentee/project/term/domain/week. Action 'set_vibe' sets the weekly vibe rating. Action 'delete' removes the note. The note body (contentJson) is collab-owned — write it in the DocEditor, not via this tool.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["upsert", "set_vibe", "delete"],
        description: "What to do.",
      },
      // upsert fields
      menteeId: {
        type: "string",
        description: "Mentee user id. Required for action=upsert.",
      },
      projectId: {
        type: "string",
        description: "Project id. Required for action=upsert.",
      },
      termId: {
        type: "string",
        description: "Term id. Required for action=upsert.",
      },
      domainId: {
        type: "string",
        description: "Domain id. Required for action=upsert.",
      },
      weekOf: {
        type: "string",
        description:
          "Week date (yyyy-mm-dd). Collapsed to Monday-UTC. Required for action=upsert.",
      },
      // set_vibe / delete fields
      id: {
        type: "string",
        description: "MentorNote id. Required for action=set_vibe and action=delete.",
      },
      vibe: {
        enum: ["Good", "Ok", "Bad", null],
        description: "Vibe rating. Required for action=set_vibe (pass null to clear).",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runManageMentorNote(
  callerId: string,
  input: {
    action: string;
    menteeId?: string;
    projectId?: string;
    termId?: string;
    domainId?: string;
    weekOf?: string;
    id?: string;
    vibe?: Vibe | null;
  },
): Promise<unknown> {
  if (!(await canViewMentorship(callerId))) {
    throw new McpForbiddenError("Only lab mentors and Core members can manage mentor notes");
  }

  requireForAction(input.action, input as Record<string, unknown>, {
    upsert: ["menteeId", "projectId", "termId", "domainId", "weekOf"],
    set_vibe: ["id"],
    delete: ["id"],
  });

  // ── upsert ─────────────────────────────────────────────────────────────────
  if (input.action === "upsert") {
    const weekOf = startOfWeekUTC(input.weekOf!);
    if (!Number.isFinite(weekOf.getTime())) {
      throw new McpInvalidError("Invalid weekOf date");
    }

    const existing = await prisma.mentorNote.findUnique({
      where: {
        mentorId_menteeId_projectId_termId_domainId_weekOf: {
          mentorId: callerId,
          menteeId: input.menteeId!,
          projectId: input.projectId!,
          termId: input.termId!,
          domainId: input.domainId!,
          weekOf,
        },
      },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };

    const template = await prisma.mentorNoteTemplate.findFirst({
      where: { isDefault: true },
      select: { contentJson: true },
    });

    const created = await prisma.mentorNote.create({
      data: {
        mentorId: callerId,
        menteeId: input.menteeId!,
        projectId: input.projectId!,
        termId: input.termId!,
        domainId: input.domainId!,
        weekOf,
        contentJson: (template?.contentJson ?? {}) as object,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  }

  // ── set_vibe / delete — load and authorize ─────────────────────────────────
  const note = await prisma.mentorNote.findUnique({
    where: { id: input.id! },
    select: { id: true, mentorId: true },
  });
  if (!note) throw new McpNotFoundError(`Mentor note ${input.id} not found`);

  const core = await isCore(callerId);
  if (note.mentorId !== callerId && !core) {
    throw new McpForbiddenError("Only the note's author or Core can modify this note");
  }

  // ── set_vibe ───────────────────────────────────────────────────────────────
  if (input.action === "set_vibe") {
    if (input.vibe !== null && input.vibe !== undefined && !VIBES.includes(input.vibe)) {
      throw new McpInvalidError(`vibe must be one of: ${VIBES.join(", ")}, or null`);
    }
    await prisma.mentorNote.update({
      where: { id: note.id },
      data: { vibe: input.vibe ?? null },
    });
    return { ok: true };
  }

  // ── delete ─────────────────────────────────────────────────────────────────
  await prisma.mentorNote.delete({ where: { id: note.id } });
  return { ok: true };
}

export const MANAGE_MENTOR_NOTE: McpTool = {
  def: MANAGE_MENTOR_NOTE_TOOL,
  run: (ctx: McpCtx, args) =>
    runManageMentorNote(ctx.user.id, args as Parameters<typeof runManageMentorNote>[1]),
};
