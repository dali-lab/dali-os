// MCP `list_email_templates` — every operator-editable email, whether or not it
// has been written yet, with its registry contract.
//
// Mirrors the /admin/email loader. Before the stores were unified this tool read
// a library that no send site touched, so it could not see the emails that
// actually ship; it now covers all of them, including hiring's, which previously
// had no MCP surface at all.
//
// Requires the `mcp:admin` scope; caller must be a Core lead.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  EMAIL_TEMPLATE_KEYS,
  emailTemplateDef,
  isEmailTemplateKey,
  type EmailTemplateKey,
} from "~/email/lib/registry";
import { listEmailTemplates } from "~/email/lib/templates.server";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import type { McpCtx } from "../../registry";

export const LIST_EMAIL_TEMPLATES_TOOL = {
  name: "list_email_templates",
  description:
    "List every operator-editable email: its key, area, what sends it, which {{variables}} it may use, " +
    "the sender identity it goes out as, whether copy has been written, and what happens when it hasn't " +
    "(skip = nothing sends, error = the action is blocked, default = built-in copy is used). " +
    "Pass includeVersions to also get each one's edit history. Only accessible to Core leads.",
  inputSchema: {
    type: "object" as const,
    properties: {
      key: {
        type: "string" as const,
        description: "Limit to one email key, e.g. \"hiring:decision:Accepted\".",
      },
      includeVersions: {
        type: "boolean" as const,
        description: "Include the append-only edit history for each email. Defaults to false.",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

export async function runListEmailTemplates(
  ctx: McpCtx,
  args: { key?: string; includeVersions?: boolean } = {},
) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can view email templates.");
  }

  const keys: EmailTemplateKey[] = args.key
    ? isEmailTemplateKey(args.key)
      ? [args.key]
      : []
    : EMAIL_TEMPLATE_KEYS;

  const stored = await listEmailTemplates();

  const versionsByKey = new Map<string, unknown[]>();
  if (args.includeVersions && keys.length > 0) {
    const rows = await prisma.emailTemplateVersion.findMany({
      where: { templateKey: { in: keys } },
      orderBy: { versionNumber: "desc" },
      // A narrow author select, not the whole User row — this output goes to an
      // agent, and the previous version of this tool returned every column.
      select: {
        templateKey: true,
        versionNumber: true,
        subject: true,
        body: true,
        createdAt: true,
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });
    for (const r of rows) {
      const list = versionsByKey.get(r.templateKey as string) ?? [];
      list.push(r);
      versionsByKey.set(r.templateKey as string, list);
    }
  }

  const templates = keys.map((key) => {
    const def = emailTemplateDef(key);
    const row = stored.get(key);
    return {
      key,
      area: def.area,
      label: def.label,
      description: def.description,
      sendsAs: def.purpose,
      variables: def.variables,
      whenMissing: def.whenMissing,
      written: !!row,
      subject: row?.subject ?? null,
      body: row?.body ?? null,
      updatedAt: row?.updatedAt ?? null,
      ...(args.includeVersions ? { versions: versionsByKey.get(key) ?? [] } : {}),
    };
  });

  return { templates };
}
