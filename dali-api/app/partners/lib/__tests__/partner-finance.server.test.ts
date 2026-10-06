import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/partners/lib/partner-emails.server");

import { prisma } from "~/lib/db";
import { sendSowSharedEmail } from "~/partners/lib/partner-emails.server";
import {
  setSowState,
  handleSowIntent,
  listOrgFinance,
  upsertInvoice,
  setInvoiceStatus,
} from "~/partners/lib/partner-finance.server";

const db = prisma as unknown as Record<string, any>;
const APP_ID = "app-1";
const ORG_ID = "org-1";

beforeEach(() => {
  vi.clearAllMocks();
  db.partnerActivity.create.mockResolvedValue({});
  db.partnerApplication.updateMany.mockResolvedValue({ count: 1 });
  db.partnerApplication.update.mockResolvedValue({});
});

describe("setSowState", () => {
  it("Draft -> Shared emails the partner and logs", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      sowState: "Draft",
      applicantContact: { name: "Ada", email: "ada@acme.com" },
    });

    const result = await setSowState({ applicationId: APP_ID, to: "Shared", actorUserId: "core-1" });

    expect(result).toEqual({ ok: true });
    expect(db.partnerApplication.update).toHaveBeenCalledWith({
      where: { id: APP_ID },
      data: { sowState: "Shared" },
    });
    expect(sendSowSharedEmail).toHaveBeenCalledWith("ada@acme.com", "Ada", APP_ID);
    expect(db.partnerActivity.create).toHaveBeenCalled();
  });

  it("Shared -> Accepted labels the latest snapshot and logs, without emailing", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      sowState: "Shared",
      applicantContact: { name: "Ada", email: "ada@acme.com" },
    });
    db.collabDocumentVersion.findFirst.mockResolvedValue({ id: "snap-1" });

    const result = await setSowState({ applicationId: APP_ID, to: "Accepted", actorUserId: null });

    expect(result).toEqual({ ok: true });
    expect(db.collabDocumentVersion.findFirst).toHaveBeenCalledWith({
      where: { name: `partnersow:${APP_ID}:body` },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    expect(db.collabDocumentVersion.update).toHaveBeenCalledWith({
      where: { id: "snap-1" },
      data: { label: expect.stringContaining("Accepted") },
    });
    expect(sendSowSharedEmail).not.toHaveBeenCalled();
  });

  it("is a no-op when there is no snapshot to label yet", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      sowState: "Shared",
      applicantContact: { name: "Ada", email: "ada@acme.com" },
    });
    db.collabDocumentVersion.findFirst.mockResolvedValue(null);

    await setSowState({ applicationId: APP_ID, to: "Accepted", actorUserId: "core-1" });
    expect(db.collabDocumentVersion.update).not.toHaveBeenCalled();
  });

  it("Accepted -> Draft (Core revert) logs without emailing or snapshotting", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      sowState: "Accepted",
      applicantContact: { name: "Ada", email: "ada@acme.com" },
    });

    const result = await setSowState({ applicationId: APP_ID, to: "Draft", actorUserId: "core-1" });
    expect(result).toEqual({ ok: true });
    expect(sendSowSharedEmail).not.toHaveBeenCalled();
    expect(db.collabDocumentVersion.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid transition (Draft -> Accepted)", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      sowState: "Draft",
      applicantContact: { name: "Ada", email: "ada@acme.com" },
    });

    const result = await setSowState({ applicationId: APP_ID, to: "Accepted", actorUserId: "core-1" });
    expect(result).toEqual({ error: "Can't move the statement of work from Draft to Accepted." });
    expect(db.partnerApplication.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid transition (Shared -> Draft)", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      sowState: "Shared",
      applicantContact: { name: "Ada", email: "ada@acme.com" },
    });

    const result = await setSowState({ applicationId: APP_ID, to: "Draft", actorUserId: "core-1" });
    expect(result).toEqual({ error: "Can't move the statement of work from Shared to Draft." });
  });

  it("is a no-op success when already in the target state", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      sowState: "Shared",
      applicantContact: { name: "Ada", email: "ada@acme.com" },
    });
    const result = await setSowState({ applicationId: APP_ID, to: "Shared", actorUserId: "core-1" });
    expect(result).toEqual({ ok: true });
    expect(db.partnerApplication.update).not.toHaveBeenCalled();
  });

  it("errors when the application does not exist", async () => {
    db.partnerApplication.findUnique.mockResolvedValue(null);
    const result = await setSowState({ applicationId: APP_ID, to: "Shared", actorUserId: "core-1" });
    expect(result).toEqual({ error: "Application not found." });
  });
});

describe("handleSowIntent", () => {
  it("rejects an invalid `to` value", async () => {
    const fd = new FormData();
    fd.set("to", "Bogus");
    const result = await handleSowIntent(fd, { applicationId: APP_ID, actorUserId: "core-1" });
    expect(result).toEqual({ error: "Invalid statement-of-work state." });
  });

  it("delegates to setSowState", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      sowState: "Draft",
      applicantContact: { name: "Ada", email: "ada@acme.com" },
    });
    const fd = new FormData();
    fd.set("to", "Shared");
    const result = await handleSowIntent(fd, { applicationId: APP_ID, actorUserId: "core-1" });
    expect(result).toEqual({ ok: true });
  });
});

describe("listOrgFinance", () => {
  it("assembles deal terms, chart strings, invoices, and outstanding total", async () => {
    db.partnerApplication.findMany.mockResolvedValue([
      { id: APP_ID, title: "Gallery Kiosk", fundingType: "DALI_GL", feeCents: 500000 },
    ]);
    db.projectPartner.findMany.mockResolvedValue([
      { projectId: "proj-1", project: { name: "Gallery Kiosk Build" } },
    ]);
    db.partnerInvoice.findMany.mockResolvedValue([
      {
        id: "inv-1",
        applicationId: APP_ID,
        projectId: "proj-1",
        amountCents: 100000,
        status: "Issued",
        issuedAt: new Date("2026-09-01T00:00:00Z"),
        dueAt: new Date("2026-10-01T00:00:00Z"),
        paidAt: null,
        reference: "INV-001",
        note: null,
      },
      {
        id: "inv-2",
        applicationId: APP_ID,
        projectId: "proj-1",
        amountCents: 200000,
        status: "Paid",
        issuedAt: new Date("2026-08-01T00:00:00Z"),
        dueAt: new Date("2026-09-01T00:00:00Z"),
        paidAt: new Date("2026-08-15T00:00:00Z"),
        reference: "INV-000",
        note: null,
      },
    ]);
    db.projectChartString.findMany.mockResolvedValue([
      {
        id: "cs-1",
        raw: "330-128512-4000",
        normalized: "330-128512-4000",
        type: "GL",
        fundingType: "DALI_GL",
        projectId: "proj-1",
        term: { code: "26F", sortKey: 10 },
      },
    ]);

    const finance = await listOrgFinance(ORG_ID);

    expect(finance.fundingByApplication).toEqual([
      { applicationId: APP_ID, title: "Gallery Kiosk", fundingType: "DALI_GL", feeCents: 500000 },
    ]);
    expect(finance.chartStrings).toEqual([
      {
        id: "cs-1",
        raw: "330-128512-4000",
        normalized: "330-128512-4000",
        type: "GL",
        fundingType: "DALI_GL",
        termCode: "26F",
        projectName: "Gallery Kiosk Build",
      },
    ]);
    expect(finance.invoices).toHaveLength(2);
    // Only the Issued invoice counts toward outstanding — Paid is settled.
    expect(finance.outstandingCents).toBe(100000);
  });

  it("skips the chart-string query when the org has no linked projects", async () => {
    db.partnerApplication.findMany.mockResolvedValue([]);
    db.projectPartner.findMany.mockResolvedValue([]);
    db.partnerInvoice.findMany.mockResolvedValue([]);

    const finance = await listOrgFinance(ORG_ID);
    expect(db.projectChartString.findMany).not.toHaveBeenCalled();
    expect(finance.chartStrings).toEqual([]);
    expect(finance.outstandingCents).toBe(0);
  });
});

describe("upsertInvoice", () => {
  it("creates a new invoice for the org", async () => {
    db.partnerInvoice.create.mockResolvedValue({ id: "inv-1" });
    const result = await upsertInvoice({
      orgId: ORG_ID,
      amountCents: 150000,
      reference: "INV-001",
    });
    expect(result).toEqual({ id: "inv-1" });
    expect(db.partnerInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: ORG_ID, amountCents: 150000 }) }),
    );
  });

  it("updates an existing invoice by id", async () => {
    db.partnerInvoice.update.mockResolvedValue({ id: "inv-1" });
    const result = await upsertInvoice({ id: "inv-1", orgId: ORG_ID, amountCents: 200000 });
    expect(result).toEqual({ id: "inv-1" });
    expect(db.partnerInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv-1" } }),
    );
    expect(db.partnerInvoice.create).not.toHaveBeenCalled();
  });
});

describe("setInvoiceStatus", () => {
  it("logs InvoiceIssued and stamps issuedAt the first time it's issued", async () => {
    db.partnerInvoice.findUnique.mockResolvedValue({
      orgId: ORG_ID,
      applicationId: APP_ID,
      status: "Draft",
      issuedAt: null,
      paidAt: null,
    });
    db.partnerInvoice.update.mockResolvedValue({});

    const result = await setInvoiceStatus({ invoiceId: "inv-1", status: "Issued", actorUserId: "core-1" });
    expect(result).toEqual({ ok: true });
    expect(db.partnerInvoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { status: "Issued", issuedAt: expect.any(Date) },
    });
    expect(db.partnerActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "InvoiceIssued" }) }),
    );
  });

  it("logs InvoicePaid and stamps paidAt", async () => {
    db.partnerInvoice.findUnique.mockResolvedValue({
      orgId: ORG_ID,
      applicationId: APP_ID,
      status: "Issued",
      issuedAt: new Date(),
      paidAt: null,
    });
    db.partnerInvoice.update.mockResolvedValue({});

    const result = await setInvoiceStatus({ invoiceId: "inv-1", status: "Paid", actorUserId: "core-1" });
    expect(result).toEqual({ ok: true });
    expect(db.partnerActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "InvoicePaid" }) }),
    );
  });

  it("does not re-log when the status is unchanged", async () => {
    db.partnerInvoice.findUnique.mockResolvedValue({
      orgId: ORG_ID,
      applicationId: APP_ID,
      status: "Paid",
      issuedAt: new Date(),
      paidAt: new Date(),
    });
    db.partnerInvoice.update.mockResolvedValue({});

    await setInvoiceStatus({ invoiceId: "inv-1", status: "Paid", actorUserId: "core-1" });
    expect(db.partnerActivity.create).not.toHaveBeenCalled();
  });

  it("errors when the invoice does not exist", async () => {
    db.partnerInvoice.findUnique.mockResolvedValue(null);
    const result = await setInvoiceStatus({ invoiceId: "nope", status: "Paid", actorUserId: "core-1" });
    expect(result).toEqual({ error: "Invoice not found." });
  });
});
