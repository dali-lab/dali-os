// MCP tool: manage_form — create, version, publish, configure, or delete a form.
// All mutations go through runFormsAction, which owns validation and business logic.
// Scope: mcp:admin, Core only.

import { runFormsAction } from "~/forms/lib/forms-data";
import { isCore } from "~/lib/roles";
import {
  requireForAction,
  McpForbiddenError,
  McpInvalidError,
  McpNotFoundError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const MANAGE_FORM_TOOL = {
  name: "manage_form",
  description:
    "Create, version, publish, configure, or delete a form. Actions: create · save_version · save_draft · publish · unpublish · set_window · set_audience · set_settings · rename · move · duplicate · delete. Core only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: [
          "create",
          "save_version",
          "save_draft",
          "publish",
          "unpublish",
          "set_window",
          "set_audience",
          "set_settings",
          "rename",
          "move",
          "duplicate",
          "delete",
        ],
        description: "The management action to perform.",
      },
      formId: {
        type: "string",
        description: "Required for all actions except create.",
      },
      name: {
        type: "string",
        description: "Form name (create / rename).",
      },
      folderPageId: {
        type: "string",
        description:
          "Target Drive folder Page ID (create / move) — a Page of kind=Folder. Empty string = top level.",
      },
      questions: {
        type: "string",
        description: "JSON-encoded Question[] (save_version / save_draft).",
      },
      description: {
        type: "string",
        description: "JSON-encoded rich-text description (save_version / save_draft).",
      },
      opensAt: {
        type: "string",
        description: "ISO datetime window opens (set_window). Empty string clears.",
      },
      closesAt: {
        type: "string",
        description: "ISO datetime window closes (set_window). Empty string clears.",
      },
      audience: {
        type: "string",
        enum: ["Members", "SignedIn", "Groups", "Public"],
        description: "Audience setting (set_audience).",
      },
      groupIds: {
        type: "array",
        items: { type: "string" },
        description: "Group IDs when audience=Groups (set_audience).",
      },
      oneResponsePerMember: {
        type: "boolean",
        description: "One-response gate (set_settings).",
      },
      notifyOnSubmission: {
        type: "boolean",
        description: "Email Core on each submission (set_settings).",
      },
      listed: {
        type: "boolean",
        description: "Show on 'Forms for you' member home (set_settings).",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  create: ["name"],
  save_version: ["formId", "questions"],
  save_draft: ["formId", "questions"],
  publish: ["formId"],
  unpublish: ["formId"],
  set_window: ["formId"],
  set_audience: ["formId", "audience"],
  set_settings: ["formId"],
  rename: ["formId", "name"],
  move: ["formId"],
  duplicate: ["formId"],
  delete: ["formId"],
};

const ACTION_INTENT: Record<string, string> = {
  create: "create-form",
  save_version: "save-version",
  save_draft: "save-draft",
  publish: "publish-form",
  unpublish: "unpublish-form",
  set_window: "update-form-window",
  set_audience: "update-form-audience",
  set_settings: "update-form-settings",
  rename: "rename-form",
  move: "move-form",
  duplicate: "duplicate-form",
  delete: "delete-form",
};

type Args = {
  action: string;
  formId?: string;
  name?: string;
  folderPageId?: string;
  questions?: string;
  description?: string;
  opensAt?: string;
  closesAt?: string;
  audience?: string;
  groupIds?: string[];
  oneResponsePerMember?: boolean;
  notifyOnSubmission?: boolean;
  listed?: boolean;
};

export async function runManageForm(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core members can manage forms");
  }

  requireForAction(args.action, args, ACTION_REQUIRED);

  const intent = ACTION_INTENT[args.action];
  const fd = new FormData();
  fd.set("intent", intent);

  if (args.formId) fd.set("id", args.formId);
  if (args.name !== undefined) fd.set("name", args.name);
  if (args.folderPageId !== undefined) fd.set("folderPageId", args.folderPageId);
  if (args.questions !== undefined) fd.set("questions", args.questions);
  if (args.description !== undefined) fd.set("description", args.description);
  if (args.opensAt !== undefined) fd.set("opensAt", args.opensAt);
  if (args.closesAt !== undefined) fd.set("closesAt", args.closesAt);
  if (args.audience !== undefined) fd.set("audience", args.audience);
  if (args.groupIds !== undefined)
    fd.set("groupIds", JSON.stringify(args.groupIds));
  if (args.oneResponsePerMember !== undefined)
    fd.set("oneResponsePerMember", String(args.oneResponsePerMember));
  if (args.notifyOnSubmission !== undefined)
    fd.set("notifyOnSubmission", String(args.notifyOnSubmission));
  if (args.listed !== undefined) fd.set("listed", String(args.listed));

  const result = await runFormsAction(fd, ctx.user.id);

  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }

  if (args.action === "duplicate" && result.formId) {
    return { ok: true, formId: result.formId };
  }
  return { ok: true };
}

export const MANAGE_FORM: McpTool = {
  def: MANAGE_FORM_TOOL,
  run: (ctx: McpCtx, args) => runManageForm(ctx, args as Args),
};
