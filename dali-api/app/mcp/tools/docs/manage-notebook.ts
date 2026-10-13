// MCP `manage_notebook` — faceted notebook management tool.
// Actions: create · set_template · add_page · detach_note · attach_note ·
// merge_into · dissolve · trash · set_series_notebook.
// Rename is manage_page / update_page; this tool adds no rename. Errors carry a
// numeric status (NotebookError), which the dispatcher maps to JSON-RPC codes.

import { McpInvalidError } from "~/mcp/errors";
import { requireForAction } from "~/mcp/registry";
import {
  addToNotebook,
  attachNote,
  createNotebook,
  detachNote,
  dissolveNotebook,
  mergeNotebooks,
  setNotebookTemplate,
  setSeriesNotebook,
  trashNotebook,
} from "~/lib/notebooks.server";
import type { McpCtx, McpTool } from "~/mcp/registry";

export const MANAGE_NOTEBOOK_TOOL_DEF = {
  name: "manage_notebook",
  description:
    "Manage meeting notebooks (a notebook holds notes as tabs). Actions: create (an empty notebook), set_template (the template new notes seed from; omit templatePageId to clear), add_page (file a doc or note into a notebook), detach_note (a meeting note becomes a plain doc in the notebook's folder), attach_note (a plain doc becomes the note for one occurrence of a meeting), merge_into (move every tab into another notebook and retire this one), dissolve (tabs become plain docs in the notebook's folder, notebook archived), trash (archive the notebook and its tabs), set_series_notebook (a meeting series' default notebook; omit notebookId to unset). Anyone who can edit a notebook can add to it; series changes and attach_note need the meeting's organizer or Core.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: [
          "create",
          "set_template",
          "add_page",
          "detach_note",
          "attach_note",
          "merge_into",
          "dissolve",
          "trash",
          "set_series_notebook",
        ],
      },
      notebookId: {
        type: "string",
        minLength: 1,
        description:
          "The notebook. Required for set_template, add_page, merge_into (the source), dissolve, trash. For set_series_notebook, the notebook to use (omit to unset).",
      },
      title: { type: "string", minLength: 1, maxLength: 200, description: "For 'create'." },
      workspaceType: { type: "string", enum: ["Lab", "Project"], description: "For 'create'." },
      workspaceId: { type: "string", description: "For 'create' in a project: the project id." },
      parentPageId: { type: "string", description: "For 'create': the folder to put it in (omit for top level)." },
      templatePageId: {
        type: "string",
        description: "For 'create' and 'set_template': a template page (isTemplate). Omit to clear on set_template.",
      },
      pageId: { type: "string", minLength: 1, description: "For add_page, detach_note, attach_note: the doc or note." },
      meetingId: { type: "string", minLength: 1, description: "For attach_note and set_series_notebook: the ScheduledMeeting id." },
      occurrenceStart: {
        type: "string",
        description: "For attach_note: ISO start of the occurrence. Omit for the first occurrence.",
      },
      targetId: { type: "string", minLength: 1, description: "For merge_into: the notebook to merge into." },
      scope: {
        type: "string",
        enum: ["future", "all"],
        description: "For set_series_notebook: future only changes the default; all also moves existing notes in.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  create: ["title", "workspaceType"],
  set_template: ["notebookId"],
  add_page: ["notebookId", "pageId"],
  detach_note: ["pageId"],
  attach_note: ["pageId", "meetingId"],
  merge_into: ["notebookId", "targetId"],
  dissolve: ["notebookId"],
  trash: ["notebookId"],
  set_series_notebook: ["meetingId", "scope"],
};

type ManageNotebookInput = {
  action: keyof typeof ACTION_REQUIRED;
  notebookId?: string;
  title?: string;
  workspaceType?: "Lab" | "Project";
  workspaceId?: string;
  parentPageId?: string;
  templatePageId?: string;
  pageId?: string;
  meetingId?: string;
  occurrenceStart?: string;
  targetId?: string;
  scope?: "future" | "all";
};

export async function runManageNotebook(callerId: string, input: ManageNotebookInput) {
  requireForAction(input.action, input as Record<string, unknown>, ACTION_REQUIRED);

  switch (input.action) {
    case "create":
      return createNotebook({
        title: input.title!,
        workspaceType: input.workspaceType!,
        workspaceId: input.workspaceId ?? null,
        parentPageId: input.parentPageId ?? null,
        templatePageId: input.templatePageId ?? null,
        actorId: callerId,
      });
    case "set_template":
      await setNotebookTemplate(input.notebookId!, input.templatePageId ?? null, callerId);
      return { ok: true };
    case "add_page":
      await addToNotebook(input.pageId!, input.notebookId!, callerId);
      return { ok: true };
    case "detach_note":
      await detachNote(input.pageId!, callerId);
      return { ok: true };
    case "attach_note": {
      const at = input.occurrenceStart ? new Date(input.occurrenceStart) : null;
      if (at && Number.isNaN(at.getTime())) throw new McpInvalidError("occurrenceStart must be an ISO date");
      return { ok: true, ...(await attachNote(input.pageId!, input.meetingId!, at, callerId)) };
    }
    case "merge_into":
      return { ok: true, ...(await mergeNotebooks(input.notebookId!, input.targetId!, callerId)) };
    case "dissolve":
      return { ok: true, ...(await dissolveNotebook(input.notebookId!, callerId)) };
    case "trash":
      await trashNotebook(input.notebookId!, callerId);
      return { ok: true };
    case "set_series_notebook":
      return {
        ok: true,
        ...(await setSeriesNotebook(input.meetingId!, input.notebookId ?? null, { scope: input.scope! }, callerId)),
      };
  }
}

export const MANAGE_NOTEBOOK: McpTool = {
  def: MANAGE_NOTEBOOK_TOOL_DEF,
  run: (ctx: McpCtx, args) => runManageNotebook(ctx.user.id, args as unknown as ManageNotebookInput),
};
