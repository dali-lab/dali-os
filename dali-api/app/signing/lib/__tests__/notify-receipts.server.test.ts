import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    signingBinding: { findUnique: vi.fn() },
    signingSignature: { findMany: vi.fn() },
    mentorshipPair: { findMany: vi.fn() },
  },
  notify: vi.fn(),
  listMembers: vi.fn(),
  getSignedCopyBody: vi.fn(),
  renderDocumentPdf: vi.fn(),
  renderFramedEmail: vi.fn(),
  enqueueOutbound: vi.fn(),
  drainNow: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({ prisma: h.prisma }));
vi.mock("~/lib/notify.server", () => ({ notify: h.notify }));
vi.mock("~/lib/gmail", () => ({}));
vi.mock("~/lib/app-env", () => ({ getFrontendUrl: () => "https://os.example.edu" }));
vi.mock("~/lib/pdf/document-pdf.server", () => ({ renderDocumentPdf: h.renderDocumentPdf }));
vi.mock("~/signing/lib/audiences", () => ({
  AUDIENCE_RESOLVERS: { Members: { listMembers: h.listMembers } },
}));
vi.mock("~/signing/lib/state.server", () => ({ getSignedCopyBody: h.getSignedCopyBody }));
vi.mock("~/lib/outbound.server", () => ({ enqueueOutbound: h.enqueueOutbound, drainNow: h.drainNow }));
vi.mock("~/email/lib/layout.server", () => ({ renderFramedEmail: h.renderFramedEmail }));

import {
  sendSignatureReceipt,
  sendCoSignedReceipts,
  notifySignRequest,
  notifyCountersignRequest,
} from "~/signing/lib/notify.server";

const USER = {
  firstName: "Ada",
  daliEmail: "ada@example.edu",
  dartmouthEmail: null,
  personalEmail: null,
  netId: null,
};

function receiptArgs(over: Record<string, unknown> = {}) {
  return {
    signerUserId: "u1",
    bindingId: "b1",
    versionId: "v1",
    documentName: "Lab <Agreement>",
    frozenBody: [{ type: "paragraph" }],
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.prisma.user.findUnique.mockResolvedValue(USER);
  h.renderDocumentPdf.mockResolvedValue(Buffer.from("%PDF"));
  h.renderFramedEmail.mockImplementation(async (m: { subject: string; bodyHtml: string; text: string }) => ({
    subject: m.subject,
    html: m.bodyHtml,
    text: m.text,
  }));
  h.enqueueOutbound.mockResolvedValue({ id: "out1" });
});

describe("sendSignatureReceipt", () => {
  it("emails the signer a transactional receipt with the PDF attached, then drains it", async () => {
    await sendSignatureReceipt(receiptArgs());
    expect(h.renderFramedEmail.mock.calls[0][1]).toEqual({ footer: "transactional" });
    expect(h.enqueueOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "email",
        target: "ada@example.edu",
        recipientUserId: "u1",
        subject: "Signed: Lab <Agreement>",
        eventType: "signing.receipt",
        dedupKey: "signing.receipt:b1:v1:u1",
        attachments: [{ filename: "Lab-Agreement.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF") }],
      }),
    );
    expect(h.drainNow).toHaveBeenCalledWith(["out1"]);
  });

  it("escapes the document name in the HTML body and links to the binding", async () => {
    await sendSignatureReceipt(receiptArgs());
    const mail = h.renderFramedEmail.mock.calls[0][0];
    expect(mail.bodyHtml).toContain("<strong>Lab &lt;Agreement&gt;</strong>");
    expect(mail.cta.href).toBe("https://os.example.edu/sign/b1");
  });

  it("dedupKey carries the version (or x) and the extra discriminator", async () => {
    await sendSignatureReceipt(receiptArgs({ versionId: undefined, dedupExtra: "mentee9" }));
    expect(h.enqueueOutbound.mock.calls[0][0].dedupKey).toBe("signing.receipt:b1:x:u1:mentee9");
  });

  it("still sends, without an attachment and pointing online, when the PDF render fails", async () => {
    h.renderDocumentPdf.mockRejectedValue(new Error("chromium down"));
    await sendSignatureReceipt(receiptArgs());
    const sent = h.enqueueOutbound.mock.calls[0][0];
    expect(sent.attachments).toBeUndefined();
    expect(h.renderFramedEmail.mock.calls[0][0].text).toContain("Your signed agreement is available online");
    expect(h.drainNow).toHaveBeenCalled();
  });

  it("falls back through dartmouth, personal, then netId addresses", async () => {
    h.prisma.user.findUnique.mockResolvedValue({ ...USER, daliEmail: null, dartmouthEmail: "a@dartmouth.edu", personalEmail: "p@example.com" });
    await sendSignatureReceipt(receiptArgs());
    expect(h.enqueueOutbound.mock.calls[0][0].target).toBe("a@dartmouth.edu");
    h.prisma.user.findUnique.mockResolvedValue({ ...USER, daliEmail: null, personalEmail: "p@example.com" });
    await sendSignatureReceipt(receiptArgs());
    expect(h.enqueueOutbound.mock.calls[1][0].target).toBe("p@example.com");
    h.prisma.user.findUnique.mockResolvedValue({ ...USER, daliEmail: null, netId: "f00abc" });
    await sendSignatureReceipt(receiptArgs());
    expect(h.enqueueOutbound.mock.calls[2][0].target).toBe("f00abc@dartmouth.edu");
  });

  it("sends nothing when the user is gone or has no address at all", async () => {
    h.prisma.user.findUnique.mockResolvedValue(null);
    await sendSignatureReceipt(receiptArgs());
    h.prisma.user.findUnique.mockResolvedValue({ ...USER, daliEmail: null });
    await sendSignatureReceipt(receiptArgs());
    expect(h.enqueueOutbound).not.toHaveBeenCalled();
  });
});

describe("notifySignRequest guards", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "b1",
    versionId: "v1",
    termId: "t1",
    document: { name: "Doc", gateScope: "App", audience: "Members", audienceGroupId: null },
    ...over,
  });

  it("does nothing for a missing binding or a non-App (hiring) document", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(null);
    await notifySignRequest("b1");
    h.prisma.signingBinding.findUnique.mockResolvedValue(
      row({ document: { name: "Doc", gateScope: "HiringCycle", audience: "Members", audienceGroupId: null } }),
    );
    await notifySignRequest("b1");
    expect(h.listMembers).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("resolves the audience for the binding's term and sends a todo with the sign link", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(row());
    h.listMembers.mockResolvedValue([{ id: "u1" }]);
    h.prisma.signingSignature.findMany.mockResolvedValue([]);
    await notifySignRequest("b1");
    expect(h.listMembers).toHaveBeenCalledWith({ termId: "t1", audienceGroupId: null });
    expect(h.prisma.signingSignature.findMany.mock.calls[0][0].where).toEqual({
      bindingId: "b1",
      roleKey: "member",
      versionId: "v1",
    });
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "document.sign_request",
        message: { vars: { itemTitle: "Doc" }, link: "/sign/b1", isTodo: true },
      }),
    );
  });

  it("an app-scoped binding resolves the audience with no term", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(row({ termId: null }));
    h.listMembers.mockResolvedValue([]);
    h.prisma.signingSignature.findMany.mockResolvedValue([]);
    await notifySignRequest("b1");
    expect(h.listMembers).toHaveBeenCalledWith({ termId: undefined, audienceGroupId: null });
  });
});

describe("notifyCountersignRequest guards", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "b1",
    versionId: "v1",
    termId: "t1",
    document: { name: "Mentorship", gateScope: "App", requiresMenteeCountersign: true },
    ...over,
  });

  it("no-ops for a missing binding, an app-scoped binding, or a non-App document", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(null);
    await notifyCountersignRequest("b1", "m1");
    h.prisma.signingBinding.findUnique.mockResolvedValue(row({ termId: null }));
    await notifyCountersignRequest("b1", "m1");
    h.prisma.signingBinding.findUnique.mockResolvedValue(
      row({ document: { name: "x", gateScope: "HiringCycle", requiresMenteeCountersign: true } }),
    );
    await notifyCountersignRequest("b1", "m1");
    expect(h.prisma.mentorshipPair.findMany).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("scopes pairs to this mentor and term, dedups mentees, and uses the countersign event", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(row());
    h.prisma.mentorshipPair.findMany.mockResolvedValue([{ menteeUserId: "bob" }, { menteeUserId: "bob" }]);
    h.prisma.signingSignature.findMany.mockResolvedValue([]);
    await notifyCountersignRequest("b1", "m1");
    expect(h.prisma.mentorshipPair.findMany.mock.calls[0][0].where).toEqual({ mentorUserId: "m1", termId: "t1" });
    expect(h.prisma.signingSignature.findMany.mock.calls[0][0].where).toEqual({
      bindingId: "b1",
      roleKey: "mentee",
      versionId: "v1",
    });
    const call = h.notify.mock.calls[0][0];
    expect(call.eventType).toBe("document.countersign_request");
    expect(call.recipients).toEqual([{ userId: "bob", dedupKey: "countersign.request:b1:v1:bob" }]);
  });

  it("does not notify when the mentor has no mentees or all have countersigned", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(row());
    h.prisma.signingSignature.findMany.mockResolvedValue([]);
    h.prisma.mentorshipPair.findMany.mockResolvedValue([]);
    await notifyCountersignRequest("b1", "m1");
    h.prisma.mentorshipPair.findMany.mockResolvedValue([{ menteeUserId: "bob" }]);
    h.prisma.signingSignature.findMany.mockResolvedValue([{ signerUserId: "bob" }]);
    await notifyCountersignRequest("b1", "m1");
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe("sendCoSignedReceipts", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    versionId: "v1",
    termId: "t1",
    document: { name: "Mentorship", requiresMenteeCountersign: true },
    ...over,
  });
  beforeEach(() => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(row());
    h.getSignedCopyBody.mockImplementation(async (_b: string, u: string) => [`body-${u}`]);
    h.prisma.mentorshipPair.findMany.mockResolvedValue([{ mentorUserId: "mA" }, { mentorUserId: "mB" }]);
    h.prisma.signingSignature.findMany.mockResolvedValue([{ signerUserId: "mA" }]);
  });

  const sentTo = () => h.enqueueOutbound.mock.calls.map((c) => c[0].recipientUserId);

  it("sends nothing for a missing binding or a document that does not opt in", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(null);
    await sendCoSignedReceipts("b1", "bob");
    h.prisma.signingBinding.findUnique.mockResolvedValue(
      row({ document: { name: "x", requiresMenteeCountersign: false } }),
    );
    await sendCoSignedReceipts("b1", "bob");
    expect(h.enqueueOutbound).not.toHaveBeenCalled();
  });

  it("emails the mentee and only the mentors who signed the in-force version", async () => {
    await sendCoSignedReceipts("b1", "bob");
    expect(sentTo()).toEqual(["bob", "mA"]);
    expect(h.prisma.signingSignature.findMany.mock.calls[0][0].where).toEqual({
      bindingId: "b1",
      roleKey: "member",
      versionId: "v1",
      signerUserId: { in: ["mA", "mB"] },
    });
  });

  it("composes the mentee's copy as the mentee and each mentor's copy for this mentee, deduped per mentee", async () => {
    await sendCoSignedReceipts("b1", "bob");
    expect(h.getSignedCopyBody).toHaveBeenNthCalledWith(1, "b1", "bob", "mentee", undefined);
    expect(h.getSignedCopyBody).toHaveBeenNthCalledWith(2, "b1", "mA", "member", "bob");
    expect(h.enqueueOutbound.mock.calls[0][0].dedupKey).toBe("signing.receipt:b1:v1:bob");
    expect(h.enqueueOutbound.mock.calls[1][0].dedupKey).toBe("signing.receipt:b1:v1:mA:bob");
  });

  it("skips a recipient whose copy cannot be composed", async () => {
    h.getSignedCopyBody.mockImplementation(async (_b: string, u: string) => (u === "bob" ? null : ["x"]));
    await sendCoSignedReceipts("b1", "bob");
    expect(sentTo()).toEqual(["mA"]);
  });

  it("one failed receipt does not stop the others", async () => {
    h.enqueueOutbound.mockRejectedValueOnce(new Error("smtp"));
    await sendCoSignedReceipts("b1", "bob");
    expect(sentTo()).toEqual(["bob", "mA"]);
  });

  it("an app-scoped binding or a mentee with no mentors only emails the mentee", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(row({ termId: null }));
    await sendCoSignedReceipts("b1", "bob");
    expect(sentTo()).toEqual(["bob"]);
    h.enqueueOutbound.mockClear();
    h.prisma.signingBinding.findUnique.mockResolvedValue(row());
    h.prisma.mentorshipPair.findMany.mockResolvedValue([]);
    await sendCoSignedReceipts("b1", "bob");
    expect(sentTo()).toEqual(["bob"]);
  });
});
