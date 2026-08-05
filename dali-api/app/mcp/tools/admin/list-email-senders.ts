// MCP `list_email_senders` — returns all configured email sender integrations,
// one per purpose, with fallback info. Mirrors the admin.email-senders.tsx loader.
// Requires the `mcp:admin` scope; caller must be a Core lead.

import { listSenderIntegrations } from "~/lib/gmail-integration";
import { EMAIL_PURPOSES, EMAIL_PURPOSE_KEYS } from "~/lib/email-identities";
import { isCore } from "~/lib/roles";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import type { McpCtx } from "../../registry";

export const LIST_EMAIL_SENDERS_TOOL = {
  name: "list_email_senders",
  description:
    "List all configured email sender integrations, one entry per email purpose. " +
    "Shows which Gmail account is linked for each purpose, when it was last used, " +
    "any sync errors, and the fallback address for purposes without a dedicated sender. " +
    "Only accessible to Core leads.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

export async function runListEmailSenders(ctx: McpCtx) {
  const callerId = ctx.user.id;
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core leads can view email sender configuration.");
  }

  const rows = await listSenderIntegrations();
  const byPurpose = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.enabled && !byPurpose.has(row.purpose)) byPurpose.set(row.purpose, row);
  }

  const senders = EMAIL_PURPOSE_KEYS.map((purpose) => {
    const row = byPurpose.get(purpose);
    const hiring = byPurpose.get("Hiring");
    return {
      purpose,
      label: EMAIL_PURPOSES[purpose].label,
      description: EMAIL_PURPOSES[purpose].description,
      integrationId: row?.id ?? null,
      sendAsEmail: row?.sendAsEmail ?? null,
      linkedAt: row?.linkedAt?.toISOString() ?? null,
      lastUsedAt: row?.lastUsedAt?.toISOString() ?? null,
      syncError: row?.syncError ?? null,
      fallbackEmail: !row && purpose !== "Hiring" ? (hiring?.sendAsEmail ?? null) : null,
    };
  });

  return { senders };
}
