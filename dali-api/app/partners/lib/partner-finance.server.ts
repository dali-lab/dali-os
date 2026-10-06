// SOW state transitions and org-level finance (chart strings, deal terms,
// invoices) for the Partner CRM. See specs/partner-crm.md §10.

import { prisma } from "~/lib/db";
import type { PartnerSowState, PartnerInvoiceStatus, ProjectFundingType } from "~/generated/prisma/enums";
import { logPartnerActivity } from "./partner-activity.server";
import { sendSowSharedEmail } from "./partner-emails.server";

// ─── SOW state ──────────────────────────────────────────────────────────────

const SOW_TRANSITIONS: Record<PartnerSowState, PartnerSowState[]> = {
  Draft: ["Shared"],
  Shared: ["Accepted"],
  // Accepted is terminal except for Core reverting back to Draft.
  Accepted: ["Draft"],
};

// Labels the most recent CollabDocumentVersion snapshot of the SOW doc — the
// same write the name_collab_version MCP tool performs. Snapshots themselves
// come from the Hocuspocus auto-snapshot machinery (app/collab/persistence.ts
// maybeSnapshot), not from this call; a never-edited SOW has none to label,
// which is a silent no-op.
async function nameLatestSowSnapshot(applicationId: string, label: string): Promise<void> {
  const docName = `partnersow:${applicationId}:body`;
  const latest = await prisma.collabDocumentVersion.findFirst({
    where: { name: docName },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (latest) {
    await prisma.collabDocumentVersion.update({ where: { id: latest.id }, data: { label } });
  }
}

export type SetSowStateResult = { ok: true } | { error: string };

/**
 * Move an application's SOW state. Draft→Shared emails the partner and logs;
 * Shared→Accepted snapshots a named version and logs; Accepted→Draft (Core
 * reverting) just logs. Any other transition is rejected. actorUserId is null
 * for the portal's own "sow-accept" action (the partner has no Core user id).
 */
export async function setSowState(args: {
  applicationId: string;
  to: PartnerSowState;
  actorUserId: string | null;
}): Promise<SetSowStateResult> {
  const app = await prisma.partnerApplication.findUnique({
    where: { id: args.applicationId },
    select: {
      sowState: true,
      applicantContact: { select: { name: true, email: true } },
    },
  });
  if (!app) return { error: "Application not found." };

  const from = app.sowState;
  if (from === args.to) return { ok: true };
  if (!SOW_TRANSITIONS[from].includes(args.to)) {
    return { error: `Can't move the statement of work from ${from} to ${args.to}.` };
  }

  await prisma.partnerApplication.update({
    where: { id: args.applicationId },
    data: { sowState: args.to },
  });

  if (from === "Draft" && args.to === "Shared") {
    if (app.applicantContact?.email) {
      await sendSowSharedEmail(app.applicantContact.email, app.applicantContact.name, args.applicationId);
    }
    await logPartnerActivity(prisma, {
      applicationId: args.applicationId,
      actorUserId: args.actorUserId,
      type: "Note",
      body: "Shared the statement of work with the partner.",
    });
  } else if (from === "Shared" && args.to === "Accepted") {
    const today = new Date().toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    await nameLatestSowSnapshot(args.applicationId, `Accepted ${today}`);
    await logPartnerActivity(prisma, {
      applicationId: args.applicationId,
      actorUserId: args.actorUserId,
      type: "Note",
      body: "The partner accepted the statement of work.",
    });
  } else if (from === "Accepted" && args.to === "Draft") {
    await logPartnerActivity(prisma, {
      applicationId: args.applicationId,
      actorUserId: args.actorUserId,
      type: "Note",
      body: "Reverted the statement of work to draft.",
    });
  }

  return { ok: true };
}

/** Intent name: "sow-state". Fields: to (Draft|Shared|Accepted). */
export async function handleSowIntent(
  formData: FormData,
  ctx: { applicationId: string; actorUserId: string | null },
): Promise<{ error: string } | { ok: true }> {
  const to = formData.get("to");
  if (to !== "Draft" && to !== "Shared" && to !== "Accepted") {
    return { error: "Invalid statement-of-work state." };
  }
  return setSowState({ applicationId: ctx.applicationId, to, actorUserId: ctx.actorUserId });
}

// ─── Org finance ────────────────────────────────────────────────────────────

export interface OrgFinance {
  fundingByApplication: {
    applicationId: string;
    title: string;
    fundingType: ProjectFundingType | null;
    feeCents: number | null;
  }[];
  chartStrings: {
    id: string;
    raw: string;
    normalized: string;
    type: string;
    fundingType: ProjectFundingType | null;
    termCode: string;
    projectName: string;
  }[];
  invoices: {
    id: string;
    applicationId: string | null;
    projectId: string | null;
    amountCents: number;
    status: PartnerInvoiceStatus;
    issuedAt: string | null;
    dueAt: string | null;
    paidAt: string | null;
    reference: string | null;
    note: string | null;
  }[];
  outstandingCents: number;
}

/** Deal terms, chart strings (via ProjectPartner → ProjectChartString), and invoices for one org. */
export async function listOrgFinance(orgId: string): Promise<OrgFinance> {
  const [applications, partnerProjects, invoices] = await Promise.all([
    prisma.partnerApplication.findMany({
      where: { partnerOrgId: orgId, stage: "Accepted" },
      select: { id: true, title: true, fundingType: true, feeCents: true },
    }),
    prisma.projectPartner.findMany({
      where: { partnerOrgId: orgId },
      select: { projectId: true, project: { select: { name: true } } },
    }),
    prisma.partnerInvoice.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        applicationId: true,
        projectId: true,
        amountCents: true,
        status: true,
        issuedAt: true,
        dueAt: true,
        paidAt: true,
        reference: true,
        note: true,
      },
    }),
  ]);

  const projectIds = [...new Set(partnerProjects.map((p) => p.projectId))];
  const projectNameById = new Map(partnerProjects.map((p) => [p.projectId, p.project.name]));
  const chartStringRows = projectIds.length
    ? await prisma.projectChartString.findMany({
        where: { projectId: { in: projectIds }, isCurrent: true },
        select: {
          id: true,
          raw: true,
          normalized: true,
          type: true,
          fundingType: true,
          projectId: true,
          term: { select: { code: true, sortKey: true } },
        },
      })
    : [];

  const chartStrings = chartStringRows
    .sort((a, b) => b.term.sortKey - a.term.sortKey)
    .map((r) => ({
      id: r.id,
      raw: r.raw,
      normalized: r.normalized,
      type: r.type,
      fundingType: r.fundingType,
      termCode: r.term.code,
      projectName: projectNameById.get(r.projectId ?? "") ?? "",
    }));

  const outstandingCents = invoices
    .filter((i) => i.status === "Issued")
    .reduce((sum, i) => sum + i.amountCents, 0);

  return {
    fundingByApplication: applications.map((a) => ({
      applicationId: a.id,
      title: a.title,
      fundingType: a.fundingType,
      feeCents: a.feeCents,
    })),
    chartStrings,
    invoices: invoices.map((i) => ({
      id: i.id,
      applicationId: i.applicationId,
      projectId: i.projectId,
      amountCents: i.amountCents,
      status: i.status,
      issuedAt: i.issuedAt?.toISOString() ?? null,
      dueAt: i.dueAt?.toISOString() ?? null,
      paidAt: i.paidAt?.toISOString() ?? null,
      reference: i.reference,
      note: i.note,
    })),
    outstandingCents,
  };
}

export interface UpsertInvoiceInput {
  id?: string;
  orgId: string;
  applicationId?: string | null;
  projectId?: string | null;
  amountCents: number;
  issuedAt?: Date | null;
  dueAt?: Date | null;
  reference?: string | null;
  note?: string | null;
}

/** Create or update a manual invoice row. No activity log on its own — status changes log. */
export async function upsertInvoice(input: UpsertInvoiceInput): Promise<{ id: string }> {
  const data = {
    amountCents: input.amountCents,
    applicationId: input.applicationId ?? null,
    projectId: input.projectId ?? null,
    issuedAt: input.issuedAt ?? null,
    dueAt: input.dueAt ?? null,
    reference: input.reference ?? null,
    note: input.note ?? null,
  };
  if (input.id) {
    const updated = await prisma.partnerInvoice.update({
      where: { id: input.id },
      data,
      select: { id: true },
    });
    return { id: updated.id };
  }
  const created = await prisma.partnerInvoice.create({
    data: { ...data, orgId: input.orgId },
    select: { id: true },
  });
  return { id: created.id };
}

export type SetInvoiceStatusResult = { ok: true } | { error: string };

/** Issued logs InvoiceIssued, Paid logs InvoicePaid on the org timeline (and stamps the matching date if unset). */
export async function setInvoiceStatus(args: {
  invoiceId: string;
  status: PartnerInvoiceStatus;
  actorUserId: string;
}): Promise<SetInvoiceStatusResult> {
  const invoice = await prisma.partnerInvoice.findUnique({
    where: { id: args.invoiceId },
    select: { orgId: true, applicationId: true, status: true, issuedAt: true, paidAt: true },
  });
  if (!invoice) return { error: "Invoice not found." };

  const now = new Date();
  const wasIssued = invoice.status === "Issued" || invoice.status === "Paid";
  const wasPaid = invoice.status === "Paid";
  await prisma.partnerInvoice.update({
    where: { id: args.invoiceId },
    data: {
      status: args.status,
      ...(args.status === "Issued" && !invoice.issuedAt ? { issuedAt: now } : {}),
      ...(args.status === "Paid" && !invoice.paidAt ? { paidAt: now } : {}),
    },
  });

  if (args.status === "Issued" && !wasIssued) {
    await logPartnerActivity(prisma, {
      orgId: invoice.orgId,
      applicationId: invoice.applicationId,
      actorUserId: args.actorUserId,
      type: "InvoiceIssued",
      metadata: { invoiceId: args.invoiceId },
    });
  } else if (args.status === "Paid" && !wasPaid) {
    await logPartnerActivity(prisma, {
      orgId: invoice.orgId,
      applicationId: invoice.applicationId,
      actorUserId: args.actorUserId,
      type: "InvoicePaid",
      metadata: { invoiceId: args.invoiceId },
    });
  }

  return { ok: true };
}
