// MCP `manage_email_template` — create a new template or update an existing one
// (rename and/or add a new version). Mirrors the admin.email-templates.tsx and
// admin.email-templates.$id.tsx actions.
// Requires the `mcp:admin` scope; caller must be a Core lead.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminInvalidError as McpInvalidError,
  requireForAction,
} from "./errors";
import type { McpCtx } from "../../registry";

export const MANAGE_EMAIL_TEMPLATE_TOOL = {
  name: "manage_email_template",
  description:
    "Create a new email template or update an existing one. " +
    "action=create: creates a blank template with the given name. " +
    "action=update: renames the template (name), creates a new version (subject + optional body), or both in one call. " +
    "Only accessible to Core leads.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "update"],
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
  });

  if (action === "create") {
    const template = await prisma.emailTemplate.create({
      data: { name: args.name! },
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
