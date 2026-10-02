// MCP `manage_email_template` — write, clear, roll back, or test one email.
//
// Mirrors the /core/communications/email action. There is no create or rename
// any more: the set of emails is fixed by the registry in code, so an agent
// edits copy rather than inventing templates. "create" was the main way the old tool could appear
// to work while affecting nothing, because the store it wrote to had no readers.
//
// Requires the `mcp:admin` scope; caller must be a Core lead.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { renderEmail } from "~/lib/email";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import {
  emailTemplateDef,
  isEmailTemplateKey,
  type EmailTemplateKey,
} from "~/email/lib/registry";
import {
  getEmailTemplate,
  rollbackEmailTemplate,
  saveEmailTemplate,
} from "~/email/lib/templates.server";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminNotFoundError as McpNotFoundError,
  AdminInvalidError as McpInvalidError,
  requireForAction,
} from "./errors";
import type { McpCtx } from "../../registry";

export const MANAGE_EMAIL_TEMPLATE_TOOL = {
  name: "manage_email_template",
  description:
    "Edit one operator-editable email, identified by its registry key (see list_email_templates). " +
    "action=save: set the subject and body. action=clear: delete the copy, which turns the email off " +
    "where the registry allows that. action=rollback: restore a previous version as a new one. " +
    "action=send_test: render with sample values and send to the caller's own DALI address. " +
    "Emails cannot be created or renamed here — the set is fixed in code. Only accessible to Core leads.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["save", "clear", "rollback", "send_test"],
        description: "The operation to perform.",
      },
      key: {
        type: "string",
        description: "The email's registry key, e.g. \"hiring:decision:Accepted\". Always required.",
      },
      subject: { type: "string", description: "Subject line. Required for save." },
      body: { type: "string", description: "Body text. Required for save." },
      versionNumber: {
        type: "number",
        description: "Required for rollback — the version to restore.",
      },
    },
    required: ["action", "key"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Input = {
  action: string;
  key?: string;
  subject?: string;
  body?: string;
  versionNumber?: number;
};

export async function runManageEmailTemplate(ctx: McpCtx, args: Input) {
  const callerId = ctx.user.id;
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core leads can manage email templates.");
  }

  const { action } = args;
  requireForAction(action, args, {
    save: ["subject", "body"],
    clear: [],
    rollback: ["versionNumber"],
    send_test: [],
  });

  if (!isEmailTemplateKey(args.key)) {
    throw new McpInvalidError(
      `Unknown email key ${JSON.stringify(args.key)}. Call list_email_templates for the valid keys.`,
    );
  }
  const key: EmailTemplateKey = args.key;
  const def = emailTemplateDef(key);

  if (action === "save") {
    await saveEmailTemplate(
      key,
      { subject: args.subject ?? "", body: args.body ?? "" },
      callerId,
    );
    return { key, saved: true as const };
  }

  if (action === "clear") {
    if (def.whenMissing === "error") {
      throw new McpInvalidError(
        `${def.label} can't be turned off — releasing is blocked when it has no copy. Edit it instead.`,
      );
    }
    await saveEmailTemplate(key, { subject: "", body: "" }, callerId);
    return { key, cleared: true as const };
  }

  if (action === "rollback") {
    const version = await prisma.emailTemplateVersion.findFirst({
      where: { templateKey: key, versionNumber: args.versionNumber },
      select: { id: true },
    });
    if (!version) {
      throw new McpNotFoundError(`${def.label} has no version ${args.versionNumber}.`);
    }
    await rollbackEmailTemplate(key, version.id, callerId);
    return { key, restoredVersion: args.versionNumber };
  }

  if (action === "send_test") {
    const copy = await getEmailTemplate(key);
    if (!copy) throw new McpNotFoundError(`${def.label} has no copy written yet.`);

    const user = await prisma.user.findUnique({
      where: { id: callerId },
      select: { daliEmail: true },
    });
    if (!user?.daliEmail) {
      throw new McpInvalidError("Your account has no DALI email address on file.");
    }

    const rendered = renderEmail(copy, def.sample as never);
    // No dedupKey — a test send must go through every time. Sent as the identity
    // this email really uses, so the From: address matches production.
    const { id } = await enqueueOutbound({
      channel: "email",
      purpose: def.purpose,
      target: user.daliEmail,
      subject: `[TEST] ${rendered.subject}`,
      bodyHtml: rendered.html,
      eventType: "admin.test_email",
    });
    await drainNow([id]);
    return { key, testSentTo: user.daliEmail };
  }

  throw new McpInvalidError(`Unknown action ${JSON.stringify(action)}.`);
}
