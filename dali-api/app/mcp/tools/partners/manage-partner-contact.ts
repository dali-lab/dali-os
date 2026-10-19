// MCP tool: manage_partner_contact — create or update a partner contact.
// Scope: mcp:write. Gated to isCore.
//
// Actions:
//   create — create a new PartnerContact. Requires name and email. If the
//            email already belongs to a contact, that contact's id is
//            returned (linkedExisting: true) instead of erroring or
//            duplicating — same rule as the Directory's "New contact" form.
//   update — update contact fields. Requires contactId. Email is re-validated
//            for uniqueness.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { normalizeEmail } from "~/partners/lib/magic-link.server";
import { isPartnerChannel } from "~/partners/lib/partner-contact";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  requireForAction,
} from "../../registry";

export const MANAGE_PARTNER_CONTACT_TOOL = {
  name: "manage_partner_contact",
  description:
    "Create or update a partner contact. Action 'create' requires name and email — an email that already belongs to a contact returns that contact (linkedExisting: true) instead of erroring. Action 'update' requires contactId. Requires Core access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: ["create", "update"], description: "What to do." },
      contactId: { type: "string", description: "Required for update." },
      name: { type: "string" },
      email: { type: "string" },
      title: { type: "string" },
      phone: { type: "string" },
      linkedinUrl: { type: "string" },
      affiliation: { type: "string" },
      notes: { type: "string" },
      preferredChannel: { type: "string", enum: ["Email", "Phone", "Slack", "Other"] },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runManagePartnerContact(
  callerId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can manage partner contacts");
  }

  const action = input.action as string;
  requireForAction(action, input, {
    create: ["name", "email"],
    update: ["contactId"],
  });

  const preferredChannelRaw = input.preferredChannel as string | undefined;
  if (preferredChannelRaw !== undefined && !isPartnerChannel(preferredChannelRaw)) {
    throw new McpInvalidError("preferredChannel must be a valid PartnerChannel");
  }

  if (action === "create") {
    const name = (input.name as string).trim();
    if (!name) throw new McpInvalidError("name cannot be empty");
    const email = normalizeEmail(input.email as string);
    if (!email.includes("@")) throw new McpInvalidError("email must be a valid address");

    const existing = await prisma.partnerContact.findUnique({
      where: { email },
      select: { id: true, name: true },
    });
    if (existing) {
      return { id: existing.id, name: existing.name, linkedExisting: true };
    }

    const contact = await prisma.partnerContact.create({
      data: {
        name,
        email,
        title: (input.title as string | undefined)?.trim() || null,
        phone: (input.phone as string | undefined)?.trim() || null,
        linkedinUrl: (input.linkedinUrl as string | undefined)?.trim() || null,
        affiliation: (input.affiliation as string | undefined)?.trim() || null,
        notes: (input.notes as string | undefined)?.trim() || null,
        preferredChannel: preferredChannelRaw ?? null,
      },
      select: { id: true, name: true },
    });
    await logAuditEvent({
      action: "partner.member.update",
      userId: callerId,
      targetId: contact.id,
      metadata: { created: true, via: "mcp" },
    });
    return { id: contact.id, name: contact.name, linkedExisting: false };
  }

  // ── update ────────────────────────────────────────────────────────────────
  const contactId = input.contactId as string;
  const existing = await prisma.partnerContact.findUnique({
    where: { id: contactId },
    select: { id: true },
  });
  if (!existing) throw new McpNotFoundError(`Partner contact ${contactId} not found`);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = (input.name as string).trim();
    if (!name) throw new McpInvalidError("name cannot be empty");
    data.name = name;
  }
  if (input.email !== undefined) {
    const email = normalizeEmail(input.email as string);
    if (!email.includes("@")) throw new McpInvalidError("email must be a valid address");
    data.email = email;
  }
  if (input.title !== undefined) data.title = (input.title as string).trim() || null;
  if (input.phone !== undefined) data.phone = (input.phone as string).trim() || null;
  if (input.linkedinUrl !== undefined) data.linkedinUrl = (input.linkedinUrl as string).trim() || null;
  if (input.affiliation !== undefined) data.affiliation = (input.affiliation as string).trim() || null;
  if (input.notes !== undefined) data.notes = (input.notes as string).trim() || null;
  if (preferredChannelRaw !== undefined) data.preferredChannel = preferredChannelRaw;

  try {
    await prisma.partnerContact.update({ where: { id: contactId }, data });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") {
      throw new McpInvalidError("Another partner contact already uses that email address");
    }
    throw e;
  }
  await logAuditEvent({
    action: "partner.member.update",
    userId: callerId,
    targetId: contactId,
  });
  return { ok: true };
}
