// MCP tool: manage_partner_invoice — create/update/set_status for manual
// partner invoice tracking. Scope: mcp:write. Gated to isCore.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { upsertInvoice, setInvoiceStatus } from "~/partners/lib/partner-finance.server";
import { McpForbiddenError, McpNotFoundError, McpInvalidError, requireForAction } from "../../registry";

const VALID_STATUSES = ["Draft", "Issued", "Paid", "Void"] as const;
type InvoiceStatus = (typeof VALID_STATUSES)[number];

export const MANAGE_PARTNER_INVOICE_TOOL = {
  name: "manage_partner_invoice",
  description:
    "Create, update, or change the status of a manual PartnerInvoice (Core only). " +
    "create (orgId, amountCents required; applicationId/projectId/reference/note/issuedAt/dueAt optional). " +
    "update (invoiceId required; any of amountCents/applicationId/projectId/reference/note/issuedAt/dueAt — unset fields keep their current value). " +
    "set_status (invoiceId, status required: Draft|Issued|Paid|Void — Issued logs InvoiceIssued and stamps issuedAt if unset, Paid logs InvoicePaid and stamps paidAt if unset, both on the org timeline).",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: ["create", "update", "set_status"], description: "What to do." },
      invoiceId: { type: "string", description: "PartnerInvoice id. Required for update/set_status." },
      orgId: { type: "string", description: "PartnerOrg id. Required for create." },
      applicationId: { type: "string", description: "Loose ref to a PartnerApplication (create/update, optional)." },
      projectId: { type: "string", description: "Loose ref to a Project (create/update, optional)." },
      amountCents: { type: "integer", minimum: 0, description: "Invoice amount in cents (create required, update optional)." },
      reference: { type: "string", description: "Invoice reference/number (create/update, optional)." },
      note: { type: "string", description: "Internal note (create/update, optional)." },
      issuedAt: { type: "string", description: "ISO 8601 issued date (create/update, optional)." },
      dueAt: { type: "string", description: "ISO 8601 due date (create/update, optional)." },
      status: {
        type: "string",
        enum: VALID_STATUSES as unknown as string[],
        description: "New status (set_status).",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

function parseDate(input: unknown, field: string): Date | null | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "string" || !input.trim()) return null;
  const d = new Date(input);
  if (isNaN(d.getTime())) throw new McpInvalidError(`Invalid ${field} value: '${input}'`);
  return d;
}

export async function runManagePartnerInvoice(
  callerId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can manage partner invoices");
  }

  const action = input.action as string;
  requireForAction(action, input, {
    create: ["orgId", "amountCents"],
    update: ["invoiceId"],
    set_status: ["invoiceId", "status"],
  });

  if (action === "create") {
    const amountCents = input.amountCents as number;
    if (!Number.isInteger(amountCents) || amountCents < 0) {
      throw new McpInvalidError("amountCents must be a non-negative integer");
    }
    const created = await upsertInvoice({
      orgId: input.orgId as string,
      amountCents,
      applicationId: typeof input.applicationId === "string" ? input.applicationId : null,
      projectId: typeof input.projectId === "string" ? input.projectId : null,
      reference: typeof input.reference === "string" ? input.reference.trim() || null : null,
      note: typeof input.note === "string" ? input.note.trim() || null : null,
      issuedAt: parseDate(input.issuedAt, "issuedAt") ?? null,
      dueAt: parseDate(input.dueAt, "dueAt") ?? null,
    });
    return { id: created.id };
  }

  if (action === "update") {
    const invoiceId = input.invoiceId as string;
    const existing = await prisma.partnerInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        orgId: true,
        applicationId: true,
        projectId: true,
        amountCents: true,
        reference: true,
        note: true,
        issuedAt: true,
        dueAt: true,
      },
    });
    if (!existing) throw new McpNotFoundError(`Partner invoice ${invoiceId} not found`);

    const amountCents =
      input.amountCents !== undefined ? (input.amountCents as number) : existing.amountCents;
    if (!Number.isInteger(amountCents) || amountCents < 0) {
      throw new McpInvalidError("amountCents must be a non-negative integer");
    }
    const issuedAt = parseDate(input.issuedAt, "issuedAt");
    const dueAt = parseDate(input.dueAt, "dueAt");

    const updated = await upsertInvoice({
      id: invoiceId,
      orgId: existing.orgId,
      amountCents,
      applicationId:
        input.applicationId !== undefined ? (input.applicationId as string | null) : existing.applicationId,
      projectId: input.projectId !== undefined ? (input.projectId as string | null) : existing.projectId,
      reference:
        typeof input.reference === "string" ? input.reference.trim() || null : existing.reference,
      note: typeof input.note === "string" ? input.note.trim() || null : existing.note,
      issuedAt: issuedAt !== undefined ? issuedAt : existing.issuedAt,
      dueAt: dueAt !== undefined ? dueAt : existing.dueAt,
    });
    return { id: updated.id };
  }

  // ── set_status ────────────────────────────────────────────────────────────
  const status = input.status as InvoiceStatus;
  const result = await setInvoiceStatus({
    invoiceId: input.invoiceId as string,
    status,
    actorUserId: callerId,
  });
  if ("error" in result) throw new McpNotFoundError(result.error);
  return { ok: true };
}
