// MCP tool: manage_mentor_note_template — Core-only admin tool for note templates.
// Scope: mcp:admin. All actions require Core.
//
// Actions:
//   create — create a new template. Setting isDefault=true clears the flag on
//             all others (single-default invariant enforced in a transaction).
//   update — update name and/or isDefault. Same invariant applies.
//   delete  — delete a template by id.
//
// The body is a collaborative document (Hocuspocus-owned). It's normally
// authored in the DocEditor, but create/update also accept optional `content`
// (Markdown) so a template can be authored end-to-end here: we write it through
// the collab pipeline (same as create_page) and mirror it into contentJson,
// which new notes seed from.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { markdownToBlocks } from "~/collab/blocknote-server";
import { replaceCollabDocContent } from "~/collab/write";
import type { McpCtx, McpTool } from "../../registry";
import {
  McpForbiddenError,
  McpInvalidError,
  McpNotFoundError,
  requireForAction,
} from "../../registry";

const MAX_MARKDOWN_LENGTH = 300_000;

// Write a template's body via the collab pipeline (so open editors update and
// the onStoreDocument hook fires), then mirror the blocks into contentJson so
// new notes seed from it even if no collab server runs in this process.
async function writeTemplateBody(id: string, markdown: string, callerId: string): Promise<void> {
  const blocks = await markdownToBlocks(markdown);
  await replaceCollabDocContent(`mentorNoteTemplate:${id}:body`, blocks, callerId);
  await prisma.mentorNoteTemplate.update({
    where: { id },
    data: { contentJson: blocks as unknown as object, lastUpdatedBy: callerId },
  });
}

export const MANAGE_MENTOR_NOTE_TEMPLATE_TOOL = {
  name: "manage_mentor_note_template",
  description:
    "Create, update, or delete a mentor note template. Core-only. Action 'create' makes a new template (optionally setting it as default). Action 'update' changes name and/or isDefault. Both create and update accept optional 'content' (Markdown) to author the template body. Action 'delete' removes a template.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "delete"],
        description: "What to do.",
      },
      // create fields
      name: {
        type: "string",
        description: "Template name. Required for action=create; optional for action=update.",
      },
      isDefault: {
        type: "boolean",
        description:
          "When true, this template becomes the default seed for new notes (clears the flag on any other template). Optional for create/update.",
      },
      content: {
        type: "string",
        maxLength: MAX_MARKDOWN_LENGTH,
        description:
          "Optional template body as Markdown (same dialect as create_page). Authors the collaborative body for create and update.",
      },
      // update / delete fields
      id: {
        type: "string",
        description: "MentorNoteTemplate id. Required for action=update and action=delete.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

export async function runManageMentorNoteTemplate(
  callerId: string,
  input: {
    action: string;
    name?: string;
    isDefault?: boolean;
    id?: string;
    content?: string;
  },
): Promise<unknown> {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can manage mentor note templates");
  }

  requireForAction(input.action, input as Record<string, unknown>, {
    create: ["name"],
    update: ["id"],
    delete: ["id"],
  });

  // ── create ───────────────────────────────────────────────────────────────────
  if (input.action === "create") {
    const name = input.name!.trim();
    if (!name) throw new McpInvalidError("name must not be blank");

    const willBeDefault = input.isDefault === true;
    const created = await prisma.$transaction(async (tx) => {
      if (willBeDefault) {
        await tx.mentorNoteTemplate.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.mentorNoteTemplate.create({
        data: {
          name,
          contentJson: {} as object,
          isDefault: willBeDefault,
          lastUpdatedBy: callerId,
        },
        select: { id: true },
      });
    });
    if (input.content !== undefined && input.content !== "") {
      await writeTemplateBody(created.id, input.content, callerId);
    }
    return { id: created.id };
  }

  // ── update / delete — load and verify ────────────────────────────────────────
  const tpl = await prisma.mentorNoteTemplate.findUnique({
    where: { id: input.id! },
    select: { id: true },
  });
  if (!tpl) throw new McpNotFoundError(`Mentor note template ${input.id} not found`);

  // ── delete ───────────────────────────────────────────────────────────────────
  if (input.action === "delete") {
    await prisma.mentorNoteTemplate.delete({ where: { id: tpl.id } });
    return { ok: true };
  }

  // ── update ───────────────────────────────────────────────────────────────────
  const data: { name?: string; isDefault?: boolean; lastUpdatedBy: string } = {
    lastUpdatedBy: callerId,
  };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new McpInvalidError("name must not be blank");
    data.name = name;
  }
  if (input.isDefault !== undefined) {
    data.isDefault = input.isDefault;
  }

  await prisma.$transaction(async (tx) => {
    if (input.isDefault === true) {
      await tx.mentorNoteTemplate.updateMany({
        where: { isDefault: true, NOT: { id: tpl.id } },
        data: { isDefault: false },
      });
    }
    await tx.mentorNoteTemplate.update({ where: { id: tpl.id }, data });
  });
  if (input.content !== undefined && input.content !== "") {
    await writeTemplateBody(tpl.id, input.content, callerId);
  }
  return { ok: true };
}

export const MANAGE_MENTOR_NOTE_TEMPLATE: McpTool = {
  def: MANAGE_MENTOR_NOTE_TEMPLATE_TOOL,
  run: (ctx: McpCtx, args) =>
    runManageMentorNoteTemplate(
      ctx.user.id,
      args as Parameters<typeof runManageMentorNoteTemplate>[1],
    ),
};
