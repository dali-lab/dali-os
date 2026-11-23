import {
  requireForAction,
  type McpCtx,
  type McpTool,
} from "../../registry";
import { requireFormEdit, runFormIntent } from "./shared";

export const SET_FORM_QUESTIONS_TOOL = {
  name: "set_form_questions",
  description:
    "Write a form's questions. save_draft stores the working copy without checks. save_version freezes the questions as a new version and publishes the form. Needs edit access on the form.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["save_version", "save_draft"],
        description: "save_version or save_draft.",
      },
      formId: {
        type: "string",
        description: "The form ID.",
      },
      questions: {
        type: "string",
        description:
          "JSON-encoded Question[] (save_version / save_draft). Each question is {key, type, required, data: {label, description?, options?, ...}}. Types: text, textarea, select, radio, checkbox, scale, date, number, email, github_url, figma_url, drive_url, file, skills_rating, reference, info, pageBreak. radio is single choice and needs data.options with at least two entries. radio and checkbox accept data.allowOther: true, which adds an Other write-in (up to 200 characters). scale is a fixed 1 to 5 rating with optional data.scaleLow and data.scaleHigh end labels. number accepts optional numeric data.min and data.max. date answers are YYYY-MM-DD. file accepts optional data.accept (comma-separated types) and data.maxFiles (1 to 10, default 1); data.exactFiles: true makes an answer need exactly maxFiles files instead of up to that many. email answers are stored lowercased. Any question can carry data.showIf: {match: 'all' | 'any', conditions: [{questionKey, op, values}]}, which shows it only when earlier answers match; on a pageBreak it shows or hides that whole page. Each condition's source must come earlier. Ops by source type: select, radio, reference: is, isNot (values: any of the options, or row ids for reference); scale: is, isNot (values '1' to '5'), atLeast, atMost (one value); checkbox: includes, excludes (any of the options); number and date: atLeast, atMost (one number, or one YYYY-MM-DD date); text, textarea, email and link types: contains (one text); every source above plus file: answered, blank (values []). For radio and checkbox with allowOther, '__other__' matches a write-in. skills_rating can't be a source. The older single-condition form {questionKey, op, value} is still read. A question that staffing reads through a column mapping can't be conditional, and neither can the page it sits on. Hidden questions are never required and store no answer.",
      },
      description: {
        type: "string",
        description: "JSON-encoded rich-text description (save_version, save_draft).",
      },
    },
    required: ["action", "formId", "questions"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  save_version: ["formId", "questions"],
  save_draft: ["formId", "questions"],
};

const ACTION_INTENT: Record<string, string> = {
  save_version: "save-version",
  save_draft: "save-draft",
};

type Args = { action: string; formId: string; questions: string; description?: string };

export async function runSetFormQuestions(ctx: McpCtx, args: Args) {
  requireForAction(args.action, args, ACTION_REQUIRED);
  await requireFormEdit(ctx.user.id, args.formId);
  await runFormIntent(ctx.user.id, ACTION_INTENT[args.action], {
    id: args.formId,
    questions: args.questions,
    description: args.description,
  });
  return { ok: true };
}

export const SET_FORM_QUESTIONS: McpTool = {
  def: SET_FORM_QUESTIONS_TOOL,
  run: (ctx: McpCtx, args) => runSetFormQuestions(ctx, args as Args),
};
