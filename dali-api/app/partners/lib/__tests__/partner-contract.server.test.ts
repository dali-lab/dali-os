import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/partners/lib/partner-emails.server");
vi.mock("~/partners/lib/partner-notify.server", () => ({ notifyPartners: vi.fn() }));

import { prisma } from "~/lib/db";
import { sendContractSentEmail } from "~/partners/lib/partner-emails.server";
import { notifyPartners } from "~/partners/lib/partner-notify.server";
import {
  listPartnerContractDocuments,
  partnerContractStatus,
  resolvePartnerContractVariables,
  sendPartnerContract,
  onPartnerContractSigned,
  handleContractIntent,
} from "~/partners/lib/partner-contract.server";

const db = prisma as unknown as Record<string, any>;
const APP_ID = "app-1";

beforeEach(() => {
  vi.clearAllMocks();
  db.partnerActivity.create.mockResolvedValue({});
  db.partnerApplication.updateMany.mockResolvedValue({ count: 1 });
});

describe("listPartnerContractDocuments", () => {
  it("lists published, non-archived documents flagged kind=PartnerContract", async () => {
    db.signingDocument.findMany.mockResolvedValue([
      { id: "doc-1", name: "Standard Partner Contract" },
    ]);
    const docs = await listPartnerContractDocuments();
    expect(db.signingDocument.findMany).toHaveBeenCalledWith({
      where: {
        kind: "PartnerContract",
        archivedAt: null,
        versions: { some: { publishedAt: { not: null } } },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    expect(docs).toEqual([{ id: "doc-1", title: "Standard Partner Contract" }]);
  });
});

describe("resolvePartnerContractVariables", () => {
  it("resolves fee, funding type, and org/partner names", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      title: "Gallery Kiosk",
      fundingType: "DALI_GL",
      feeCents: 500000,
      legalEntityName: "Acme LLC",
      legalEntityAddress: "123 Main St",
      applicantContact: { name: "Ada Lovelace" },
      partnerOrg: { name: "Acme" },
      targetTerms: [{ term: { code: "26F" } }],
    });

    const vars = await resolvePartnerContractVariables(APP_ID);

    expect(vars).toEqual({
      partnerName: "Ada Lovelace",
      orgName: "Acme",
      legalEntityName: "Acme LLC",
      legalEntityAddress: "123 Main St",
      fee: "$5,000.00",
      fundingType: "DALI GL",
      projectTitle: "Gallery Kiosk",
      term: "26F",
    });
  });

  it("falls back to the applicant's name when there is no org yet", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      title: "Gallery Kiosk",
      fundingType: null,
      feeCents: null,
      legalEntityName: null,
      legalEntityAddress: null,
      applicantContact: { name: "Ada Lovelace" },
      partnerOrg: null,
      targetTerms: [],
    });

    const vars = await resolvePartnerContractVariables(APP_ID);
    expect(vars.orgName).toBe("Ada Lovelace");
    expect(vars.fee).toBe("");
    expect(vars.fundingType).toBe("");
    expect(vars.term).toBe("");
  });
});

describe("sendPartnerContract", () => {
  it("creates the binding, stores contractBindingId, logs, and emails the partner", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      id: APP_ID,
      applicantContact: { name: "Ada Lovelace", email: "ada@acme.com" },
    });
    db.signingDocumentVersion.findFirst.mockResolvedValue({ id: "ver-1", body: [] });
    db.signingBinding.upsert.mockResolvedValue({ id: "binding-1" });
    db.partnerApplication.update.mockResolvedValue({});
    db.signingSignature.upsert.mockResolvedValue({});

    const result = await sendPartnerContract({
      applicationId: APP_ID,
      documentId: "doc-1",
      actorUserId: "core-1",
    });

    expect(result).toEqual({ ok: true, bindingId: "binding-1" });
    expect(db.signingBinding.upsert).toHaveBeenCalledWith({
      where: { documentId_scopeKey: { documentId: "doc-1", scopeKey: `partner-app:${APP_ID}` } },
      create: { documentId: "doc-1", versionId: "ver-1", scopeKey: `partner-app:${APP_ID}` },
      update: { versionId: "ver-1" },
      select: { id: true },
    });
    expect(db.partnerApplication.update).toHaveBeenCalledWith({
      where: { id: APP_ID },
      data: { contractBindingId: "binding-1" },
    });
    expect(db.partnerActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "ContractSent" }),
      }),
    );
    expect(sendContractSentEmail).toHaveBeenCalledWith(
      "ada@acme.com",
      "Ada Lovelace",
      expect.stringContaining(`/partner/applications/${APP_ID}/sign-contract`),
    );
  });

  it("errors when the document has no published version", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      id: APP_ID,
      applicantContact: { name: "Ada", email: "ada@acme.com" },
    });
    db.signingDocumentVersion.findFirst.mockResolvedValue(null);

    const result = await sendPartnerContract({
      applicationId: APP_ID,
      documentId: "doc-1",
      actorUserId: "core-1",
    });
    expect(result).toEqual({ error: "That document has no published version to send." });
    expect(db.signingBinding.upsert).not.toHaveBeenCalled();
  });

  it("errors when the application does not exist", async () => {
    db.partnerApplication.findUnique.mockResolvedValue(null);
    const result = await sendPartnerContract({
      applicationId: APP_ID,
      documentId: "doc-1",
      actorUserId: "core-1",
    });
    expect(result).toEqual({ error: "Application not found." });
  });
});

describe("partnerContractStatus", () => {
  it("is NotSent when no binding has been created", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ contractBindingId: null });
    const status = await partnerContractStatus(APP_ID);
    expect(status).toEqual({ state: "NotSent", bindingId: null, signedAt: null });
  });

  it("is Sent when a binding exists with no matching signature", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ contractBindingId: "binding-1" });
    db.signingBinding.findUnique.mockResolvedValue({ versionId: "ver-1", signatures: [] });
    const status = await partnerContractStatus(APP_ID);
    expect(status).toEqual({ state: "Sent", bindingId: "binding-1", signedAt: null });
  });

  it("is Signed with a PDF link when the member has signed the in-force version", async () => {
    const signedAt = new Date("2026-10-01T12:00:00Z");
    db.partnerApplication.findUnique.mockResolvedValue({ contractBindingId: "binding-1" });
    db.signingBinding.findUnique.mockResolvedValue({
      versionId: "ver-1",
      signatures: [{ versionId: "ver-1", signedAt }],
    });
    const status = await partnerContractStatus(APP_ID);
    expect(status).toEqual({
      state: "Signed",
      bindingId: "binding-1",
      signedAt: signedAt.toISOString(),
      pdfUrl: "/sign/binding-1/pdf",
    });
  });

  it("does not count a signature on a superseded version as Signed", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ contractBindingId: "binding-1" });
    db.signingBinding.findUnique.mockResolvedValue({
      versionId: "ver-2",
      signatures: [{ versionId: "ver-1", signedAt: new Date() }],
    });
    const status = await partnerContractStatus(APP_ID);
    expect(status.state).toBe("Sent");
  });
});

describe("onPartnerContractSigned", () => {
  it("logs ContractSigned and notifies Core", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ title: "Gallery Kiosk" });
    await onPartnerContractSigned({ applicationId: APP_ID, bindingId: "binding-1" });

    expect(db.partnerActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "ContractSigned" }) }),
    );
    expect(notifyPartners).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "partner.contract_signed",
        title: "Gallery Kiosk signed their contract",
      }),
    );
  });
});

describe("handleContractIntent", () => {
  it("requires a documentId", async () => {
    const fd = new FormData();
    const result = await handleContractIntent(fd, { applicationId: APP_ID, actorUserId: "core-1" });
    expect(result).toEqual({ error: "Choose a document to send." });
  });

  it("delegates to sendPartnerContract", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      id: APP_ID,
      applicantContact: { name: "Ada", email: "ada@acme.com" },
    });
    db.signingDocumentVersion.findFirst.mockResolvedValue({ id: "ver-1", body: [] });
    db.signingBinding.upsert.mockResolvedValue({ id: "binding-1" });

    const fd = new FormData();
    fd.set("documentId", "doc-1");
    const result = await handleContractIntent(fd, { applicationId: APP_ID, actorUserId: "core-1" });
    expect(result).toEqual({ ok: true });
  });
});
