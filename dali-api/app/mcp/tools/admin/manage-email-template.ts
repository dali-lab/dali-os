// MCP `manage_email_template` — create a new template or update an existing one
// (rename and/or add a new version). Mirrors the admin.email-templates.tsx and
// admin.email-templates.$id.tsx actions.
// Requires the `mcp:admin` scope; caller must be a Core lead.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminNotFoundError as McpNotFoundError,
  AdminInvalidError as McpInvalidError,
  requireForAction,
} from "./errors";
import type { McpCtx } from "../../registry";
import { ensureProcessFolder, CORE_PROCESS_ID } from "~/lib/bindings.server";

export const MANAGE_EMAIL_TEMPLATE_TOOL = {
  name: "manage_email_template",
  description:
    "Create a new email template or update an existing one. " +
    "action=create: creates a blank template with the given name. " +
    "action=update: renames the template (name), creates a new version (subject + optional body), or both in one call. " +
    "action=send_test: renders a specific version and sends a test email to the caller's own DALI address. " +
    "Only accessible to Core leads.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "send_test"],
        description: "The operation to perform.",
      },
      name: {
        type: "string",
        description:
          "Template name. Required for create; optional rename for update.",
      },
      templateId: {
        type: "string",
        description: "Required for update — the id of the template to modify.",
      },
      subject: {
        type: "string",
        description:
          "Email subject line. Providing this (with action=update) creates a new template version.",
      },
      body: {
        type: "string",
        description:
          "Email body HTML/text. Only used when subject is also provided (new version). Defaults to empty string.",
      },
      versionId: {
        type: "string",
        description: "Required for send_test — the id of the template version to send.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Input = {
  action: string;
  name?: string;
  templateId?: string;
  subject?: string;
  body?: string;
  versionId?: string;
};

export async function runManageEmailTemplate(ctx: McpCtx, args: Input) {
  const callerId = ctx.user.id;
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core leads can manage email templates.");
  }

  const { action } = args;
  requireForAction(action, args, {
    create: ["name"],
    update: ["templateId"],
    send_test: ["versionId"],
  });

  if (action === "send_test") {
    const version = await prisma.emailTemplateVersion.findUnique({
      where: { id: args.versionId },
      select: { subject: true, body: true },
    });
    if (!version) throw new McpNotFoundError("Template version not found.");

    const user = await prisma.user.findUnique({
      where: { id: callerId },
      select: { firstName: true, daliEmail: true },
    });
    const toEmail = user?.daliEmail;
    if (!toEmail) throw new McpInvalidError("Your account has no DALI email address on file.");

    const sampleVars = {
      firstName: user?.firstName || "FirstName",
      domain: "Product Design",
      time: "Friday, Jan 10 at 2:00 PM",
      location: "MacLean 132",
      meetingUrl: "https://dartmouth.zoom.us/j/example",
      originalCloseDate: "January 7",
      newCloseDate: "January 14",
    };
    const { renderEmail } = await import("~/lib/email");
    const { enqueueOutbound, drainNow } = await import("~/lib/outbound.server");
    const { subject: renderedSubject, html } = renderEmail(
      { subject: version.subject, body: version.body },
      sampleVars,
    );
    const { id } = await enqueueOutbound({
      channel: "email",
      purpose: "Hiring",
      target: toEmail,
      subject: renderedSubject,
      bodyHtml: html,
      eventType: "admin.test_email",
    });
    await drainNow([id]);
    return { ok: true, sentTo: toEmail };
  }

  if (action === "create") {
    const folderPageId = await ensureProcessFolder({
      processType: "Core",
      processId: CORE_PROCESS_ID,
      purpose: "email-templates",
      createdById: callerId,
    }).catch(() => null);
    const template = await prisma.emailTemplate.create({
      data: { name: args.name!, folderPageId },
    });
    return template;
  }

  // action === "update"
  const { templateId, name, subject, body } = args;

  if (name === undefined && subject === undefined) {
    throw new McpInvalidError(
      "action 'update' requires at least one of: name (rename), subject (new version).",
    );
  }

  if (name !== undefined) {
    await prisma.emailTemplate.update({
      where: { id: templateId },
      data: { name },
    });
  }

  if (subject !== undefined) {
    const member = await prisma.dALIMember.findUnique({
      where: { userId: callerId },
    });
    if (!member) throw new McpForbiddenError("Must be a DALI member.");

    const lastVersion = await prisma.emailTemplateVersion.findFirst({
      where: { templateId },
      orderBy: { versionNumber: "desc" },
    });
    const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

    await prisma.emailTemplateVersion.create({
      data: {
        templateId: templateId!,
        versionNumber,
        subject,
        body: body ?? "",
        createdById: callerId,
      },
    });
  }

  return { ok: true };
}
