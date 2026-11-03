// MCP tool: manage_form — create, version, publish, configure, or delete a form.
// All mutations go through runFormsAction, which owns validation and business logic.
// Scope: mcp:admin; edit access on the form (create: on the folder).

import { runFormsAction } from "~/forms/lib/forms-data";
import { canBuildForm, canCreateForm } from "~/forms/lib/form-access.server";
import { deleteFormResponse } from "~/forms/lib/form-response.server";
import { sendFormReminder } from "~/forms/lib/form-tracker.server";
import { requireFormUpgrades } from "./require-form-upgrades";
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
    "Create, version, publish, configure, or delete a form, delete a response, or remind people who haven't responded. Actions: create · save_version · save_draft · publish · unpublish · set_window · set_audience · set_settings · rename · move · duplicate · delete · delete_response · send_reminder. Needs edit access on the form (create: on the folder). set_audience sets the form page's general access. set_settings changes only the settings you pass. delete_response is permanent and lets the person fill the form again. send_reminder is limited to one per form every 24 hours. allowResponseEdit, remindBeforeClose, sendReceipt, confirmationMessage, delete_response and send_reminder need the form-upgrades flag.",
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
          "delete_response",
          "send_reminder",
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
        description:
          "JSON-encoded Question[] (save_version / save_draft). Each question is {key, type, required, data: {label, description?, options?, ...}}. Types: text, textarea, select, radio, checkbox, scale, date, number, email, github_url, figma_url, drive_url, file, skills_rating, reference, info, pageBreak. radio is single choice and needs data.options with at least two entries. radio and checkbox accept data.allowOther: true, which adds an Other write-in (up to 200 characters). scale is a fixed 1 to 5 rating with optional data.scaleLow and data.scaleHigh end labels. number accepts optional numeric data.min and data.max. date answers are YYYY-MM-DD. email answers are stored lowercased. Any question except pageBreak can carry data.showIf: {questionKey, op, value}, which shows it only when an earlier question matches. The source must come earlier and be select, radio or scale (op is or isNot) or checkbox (op includes or excludes). value is one of the source's options, or '1' to '5' for scale. A question that staffing reads through a column mapping can't carry showIf. Hidden questions are never required and store no answer.",
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
      allowResponseEdit: {
        type: "boolean",
        description:
          "Let respondents change their own answers while the form is open (set_settings). Needs oneResponsePerMember.",
      },
      remindBeforeClose: {
        type: "boolean",
        description:
          "Remind people who haven't responded a day before the form closes (set_settings). Needs a close time.",
      },
      sendReceipt: {
        type: "boolean",
        description: "Email respondents a copy of their answers on submit (set_settings).",
      },
      confirmationMessage: {
        type: "string",
        description:
          "JSON-encoded rich-text blocks shown after submitting, in place of the default copy (set_settings). Empty string clears.",
      },
      submissionId: {
        type: "string",
        description: "The response to delete, an id from get_form_responses (delete_response).",
      },
      message: {
        type: "string",
        description: "The reminder text (send_reminder).",
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
  delete_response: ["formId", "submissionId"],
  send_reminder: ["formId", "message"],
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
  allowResponseEdit?: boolean;
  remindBeforeClose?: boolean;
  sendReceipt?: boolean;
  confirmationMessage?: string;
  submissionId?: string;
  message?: string;
};

function unwrap<T extends object>(result: T | { error: string; status: number }): T {
  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }
  return result;
}

export async function runManageForm(ctx: McpCtx, args: Args) {
  requireForAction(args.action, args, ACTION_REQUIRED);

  const allowed =
    args.action === "create"
      ? await canCreateForm(ctx.user.id, args.folderPageId || null)
      : await canBuildForm(ctx.user.id, args.formId!);
  if (!allowed) throw new McpForbiddenError("You do not have edit access to this form");

  if (args.action === "delete_response") {
    await requireFormUpgrades(ctx);
    return unwrap(
      await deleteFormResponse({
        formId: args.formId!,
        submissionId: args.submissionId!,
        actorId: ctx.user.id,
        request: ctx.request,
      }),
    );
  }

  if (args.action === "send_reminder") {
    await requireFormUpgrades(ctx);
    return unwrap(
      await sendFormReminder({
        formId: args.formId!,
        actorId: ctx.user.id,
        message: args.message!,
        request: ctx.request,
      }),
    );
  }

  if (args.action === "set_settings") {
    const upgraded = [
      args.allowResponseEdit,
      args.remindBeforeClose,
      args.sendReceipt,
      args.confirmationMessage,
    ].some((v) => v !== undefined);
    const anySetting =
      upgraded ||
      [args.oneResponsePerMember, args.notifyOnSubmission, args.listed].some((v) => v !== undefined);
    if (!anySetting) throw new McpInvalidError("action 'set_settings' needs at least one setting");
    if (upgraded) await requireFormUpgrades(ctx);
  }

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
  if (args.allowResponseEdit !== undefined)
    fd.set("allowResponseEdit", String(args.allowResponseEdit));
  if (args.remindBeforeClose !== undefined)
    fd.set("remindBeforeClose", String(args.remindBeforeClose));
  if (args.sendReceipt !== undefined) fd.set("sendReceipt", String(args.sendReceipt));
  if (args.confirmationMessage !== undefined)
    fd.set("confirmationMessage", args.confirmationMessage);

  const result = unwrap(await runFormsAction(fd, ctx.user.id));

  if (args.action === "duplicate" && result.formId) {
    return { ok: true, formId: result.formId };
  }
  return { ok: true };
}

export const MANAGE_FORM: McpTool = {
  def: MANAGE_FORM_TOOL,
  run: (ctx: McpCtx, args) => runManageForm(ctx, args as Args),
};
