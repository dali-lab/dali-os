import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    signingBinding: { findUnique: vi.fn() },
    signingSignature: { findFirst: vi.fn(), count: vi.fn() },
    mentorshipPair: { findMany: vi.fn(), count: vi.fn() },
  },
  requireAuth: vi.fn(),
  getBindingStateForUser: vi.fn(),
  getSignerCohortsForBinding: vi.fn(),
  resolveGroupMembers: vi.fn(),
  menteeCountersignState: vi.fn(),
  getSignedCopyBody: vi.fn(),
  includes: vi.fn(),
  recordSignature: vi.fn(),
  notifyCountersignRequest: vi.fn(),
  sendCoSignedReceipts: vi.fn(),
  resolveVars: vi.fn(),
  bakeSigningBody: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({ prisma: h.prisma }));
vi.mock("~/lib/auth", () => ({ requireAuth: h.requireAuth }));
vi.mock("~/lib/login-next", () => ({
  redirectToLogin: () => new Response(null, { status: 302, headers: { Location: "/login" } }),
}));
vi.mock("~/components/doc", () => ({
  DocEditor: () => null,
  looksLikeProseMirrorDoc: (v: unknown) => (v as { type?: string } | null)?.type === "doc",
}));
vi.mock("~/components/ui/Button", () => ({ buttonClasses: () => "" }));
vi.mock("~/signing/components/SigningFillView", () => ({ SigningFillView: () => null }));
vi.mock("~/collab/legacy/pm-to-blocknote", () => ({
  ensureBlocks: (b: unknown) => (Array.isArray(b) ? b : [{ id: "converted" }]),
}));
vi.mock("~/collab/export-html", () => ({ renderNodes: () => "<p>legacy</p>" }));
vi.mock("~/lib/signing-fields", () => ({
  collectSigningFields: () => [{ fieldId: "f1" }],
  bakeSigningBody: h.bakeSigningBody,
}));
vi.mock("~/signing/lib/state.server", () => ({
  getBindingStateForUser: h.getBindingStateForUser,
  getSignerCohortsForBinding: h.getSignerCohortsForBinding,
  menteeCountersignState: h.menteeCountersignState,
  getSignedCopyBody: h.getSignedCopyBody,
}));
vi.mock("~/signing/lib/audiences", () => ({
  AUDIENCE_RESOLVERS: { Members: { includes: h.includes }, Group: { includes: h.includes } },
}));
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: h.resolveGroupMembers }));
vi.mock("~/signing/lib/sign.server", () => ({ recordSignature: h.recordSignature }));
vi.mock("~/signing/lib/notify.server", () => ({
  notifyCountersignRequest: h.notifyCountersignRequest,
  sendCoSignedReceipts: h.sendCoSignedReceipts,
}));
vi.mock("~/signing/lib/variables.server", () => ({ resolveSigningVariablesForSigner: h.resolveVars }));

import { loader, action } from "~/signing/routes/sign.$bindingId";

const BINDING = {
  id: "b1",
  versionId: "v1",
  termId: "t1",
  document: { name: "Member Agreement", audience: "Members", requiresMenteeCountersign: false },
  version: { body: [{ id: "blk" }] },
  term: { code: "26F" },
  signatures: [{ typedName: "Grace Hopper" }],
};

function load(url = "http://localhost/sign/b1") {
  return loader({ request: new Request(url), params: { bindingId: "b1" }, context: {} } as never) as Promise<any>;
}

function submit(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return action({
    request: new Request("http://localhost/sign/b1", { method: "POST", body }),
    params: { bindingId: "b1" },
    context: {},
  } as never) as Promise<any>;
}

// Drive resolveSigning: member in audience / member state / mentee state.
function slots(opts: { inAudience?: boolean; member?: "signed" | "unsigned"; mentee?: "owed" | "signed" | "not_owed" }) {
  h.includes.mockReturnValue(opts.inAudience ?? true);
  h.getBindingStateForUser.mockResolvedValue({ status: opts.member ?? "unsigned" });
  h.menteeCountersignState.mockResolvedValue(opts.mentee ?? "not_owed");
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
  h.prisma.signingBinding.findUnique.mockResolvedValue(BINDING);
  h.getSignerCohortsForBinding.mockResolvedValue({});
  h.resolveVars.mockResolvedValue({ name: "Ada" });
  h.recordSignature.mockResolvedValue({ ok: true });
  h.notifyCountersignRequest.mockResolvedValue(undefined);
  h.sendCoSignedReceipts.mockResolvedValue(undefined);
  h.prisma.mentorshipPair.findMany.mockResolvedValue([]);
  h.prisma.mentorshipPair.count.mockResolvedValue(0);
  slots({});
});

describe("loader access", () => {
  it("sends unauthenticated visitors to login", async () => {
    h.requireAuth.mockResolvedValue({ ok: false });
    const res = await load();
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("redirects to /sign when the binding does not exist", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(null);
    expect((await load()).headers.get("Location")).toBe("/sign");
  });

  it("redirects home when the user has no slot on the binding (not in audience, no countersign, never signed)", async () => {
    slots({ inAudience: false, member: "unsigned", mentee: "not_owed" });
    expect((await load()).headers.get("Location")).toBe("/");
  });

  it("gates on the binding's own term and audience", async () => {
    await load();
    expect(h.getSignerCohortsForBinding).toHaveBeenCalledWith("u1", "t1");
    expect(h.getBindingStateForUser).toHaveBeenCalledWith("u1", "b1", "member");
  });
});

describe("fixed-group audience", () => {
  const groupBinding = { ...BINDING, document: { ...BINDING.document, audience: "Group", audienceGroupId: "g1" } };

  it("checks the audience against the fixed group, so a group member who isn't staffed this term can open it", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(groupBinding);
    h.resolveGroupMembers.mockResolvedValue(["u1"]);
    await load();
    expect(h.resolveGroupMembers).toHaveBeenCalledWith("g1");
    expect(h.includes).toHaveBeenCalledWith(expect.anything(), { audienceGroupId: "g1", userGroupIds: new Set(["g1"]) });
  });

  it("gives a non-member of the group no group membership", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(groupBinding);
    h.resolveGroupMembers.mockResolvedValue(["someone-else"]);
    await load();
    expect(h.includes).toHaveBeenCalledWith(expect.anything(), { audienceGroupId: "g1", userGroupIds: new Set() });
  });

  it("uses the same group check when signing", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(groupBinding);
    h.resolveGroupMembers.mockResolvedValue(["u1"]);
    await submit({ intent: "sign", fieldValues: "{}" });
    expect(h.includes).toHaveBeenCalledWith(expect.anything(), { audienceGroupId: "g1", userGroupIds: new Set(["g1"]) });
  });

  it("doesn't look up group members for audiences without a fixed group", async () => {
    await load();
    expect(h.resolveGroupMembers).not.toHaveBeenCalled();
  });
});

describe("loader slot selection", () => {
  it("an unsigned in-audience member gets the member fill form with the supervisor name as a variable", async () => {
    const data = await load();
    expect(data).toMatchObject({ name: "Member Agreement", status: "unsigned", signerRole: "member", bindingId: "b1" });
    expect(data.fields).toEqual([{ fieldId: "f1" }]);
    expect(data.signedBlocks).toBeNull();
    expect(h.resolveVars).toHaveBeenCalledWith("u1", {
      supervisorName: "Grace Hopper",
      termCode: "26F",
      role: "member",
      termId: "t1",
    });
  });

  it("a mentor who still owes the member signature signs before countersigning anything", async () => {
    slots({ member: "unsigned", mentee: "owed" });
    expect((await load()).signerRole).toBe("member");
  });

  it("a mentee (not in the audience) countersigns as mentee", async () => {
    slots({ inAudience: false, mentee: "owed" });
    h.prisma.mentorshipPair.findMany.mockResolvedValue([{ mentorUserId: "mentorA" }]);
    h.prisma.signingSignature.findFirst.mockResolvedValue(null);
    const data = await load();
    expect(data).toMatchObject({ signerRole: "mentee", status: "unsigned" });
  });

  it("a mentee who already countersigned sees the signed copy as mentee", async () => {
    slots({ inAudience: false, mentee: "signed" });
    h.getSignedCopyBody.mockResolvedValue([{ id: "frozen" }]);
    const data = await load();
    expect(data).toMatchObject({ signerRole: "mentee", status: "signed", signedBlocks: [{ id: "frozen" }] });
    expect(h.getSignedCopyBody).toHaveBeenCalledWith("b1", "u1", "mentee");
  });

  it("a signed member who left the audience can still reopen their copy", async () => {
    slots({ inAudience: false, member: "signed" });
    h.getSignedCopyBody.mockResolvedValue([{ id: "frozen" }]);
    expect(await load()).toMatchObject({ signerRole: "member", status: "signed" });
  });

  it("a signed member still in the audience sees the signed copy rather than the form", async () => {
    slots({ member: "signed" });
    h.getSignedCopyBody.mockResolvedValue([{ id: "frozen" }]);
    expect(await load()).toMatchObject({ signerRole: "member", status: "signed" });
  });
});

describe("loader signed copy", () => {
  beforeEach(() => slots({ member: "signed" }));

  it("falls back to the version body when no signed copy can be composed", async () => {
    h.getSignedCopyBody.mockResolvedValue(null);
    expect((await load()).signedBlocks).toEqual([{ id: "blk" }]);
  });

  it("renders a legacy ProseMirror frozen copy as HTML, not blocks", async () => {
    h.getSignedCopyBody.mockResolvedValue({ type: "doc", content: [] });
    const data = await load();
    expect(data.signedLegacyHtml).toBe("<p>legacy</p>");
    expect(data.signedBlocks).toBeNull();
  });

  it("loads no signed copy while the form is shown", async () => {
    slots({ member: "unsigned" });
    await load();
    expect(h.getSignedCopyBody).not.toHaveBeenCalled();
  });
});

describe("loader mentee body and coSigned flag", () => {
  it("a mentee sees their earliest-signing mentor's fields baked into the body", async () => {
    slots({ inAudience: false, mentee: "owed" });
    h.prisma.mentorshipPair.findMany.mockResolvedValue([{ mentorUserId: "mA" }, { mentorUserId: "mB" }]);
    h.prisma.signingSignature.findFirst.mockResolvedValue({ fieldValues: { f9: "Ada Lovelace" } });
    h.bakeSigningBody.mockReturnValue([{ id: "baked" }]);
    const data = await load();
    expect(h.prisma.signingSignature.findFirst.mock.calls[0][0]).toMatchObject({
      where: { bindingId: "b1", roleKey: "member", versionId: "v1", signerUserId: { in: ["mA", "mB"] } },
      orderBy: { signedAt: "asc" },
    });
    expect(h.bakeSigningBody).toHaveBeenCalledWith([{ id: "blk" }], { fieldValues: { f9: "Ada Lovelace" } });
    expect(data.body).toEqual([{ id: "baked" }]);
  });

  it("the body is left alone when the mentor captured no values or the mentee has no mentors", async () => {
    slots({ inAudience: false, mentee: "owed" });
    h.prisma.mentorshipPair.findMany.mockResolvedValue([{ mentorUserId: "mA" }]);
    h.prisma.signingSignature.findFirst.mockResolvedValue({ fieldValues: null });
    expect((await load()).body).toEqual([{ id: "blk" }]);
    h.prisma.mentorshipPair.findMany.mockResolvedValue([]);
    expect((await load()).body).toEqual([{ id: "blk" }]);
    expect(h.bakeSigningBody).not.toHaveBeenCalled();
  });

  it("a member never gets a mentor's values baked in", async () => {
    await load();
    expect(h.bakeSigningBody).not.toHaveBeenCalled();
  });

  describe("coSigned (mentor still waiting on a mentee)", () => {
    beforeEach(() => {
      slots({ member: "signed" });
      h.getSignedCopyBody.mockResolvedValue([]);
      h.prisma.signingBinding.findUnique.mockResolvedValue({
        ...BINDING,
        document: { ...BINDING.document, requiresMenteeCountersign: true },
      });
      h.prisma.mentorshipPair.findMany.mockResolvedValue([{ menteeUserId: "bob" }, { menteeUserId: "cy" }]);
    });

    it("is true while at least one mentee has not countersigned", async () => {
      h.prisma.signingSignature.count.mockResolvedValue(1);
      expect((await load()).coSigned).toBe(true);
      expect(h.prisma.signingSignature.count.mock.calls[0][0].where).toEqual({
        bindingId: "b1",
        roleKey: "mentee",
        versionId: "v1",
        signerUserId: { in: ["bob", "cy"] },
      });
    });

    it("is false once every mentee has countersigned", async () => {
      h.prisma.signingSignature.count.mockResolvedValue(2);
      expect((await load()).coSigned).toBe(false);
    });

    it("is false for a mentor with no mentees", async () => {
      h.prisma.mentorshipPair.findMany.mockResolvedValue([]);
      expect((await load()).coSigned).toBe(false);
    });

    it("is false when the document does not use countersignatures", async () => {
      h.prisma.signingBinding.findUnique.mockResolvedValue(BINDING);
      expect((await load()).coSigned).toBe(false);
      expect(h.prisma.signingSignature.count).not.toHaveBeenCalled();
    });
  });
});

describe("loader next param", () => {
  it("keeps same-site paths and drops absolute or protocol-relative URLs", async () => {
    expect((await load("http://localhost/sign/b1?next=/projects/p1")).next).toBe("/projects/p1");
    expect((await load("http://localhost/sign/b1?next=//evil.example")).next).toBeNull();
    expect((await load("http://localhost/sign/b1?next=https://evil.example")).next).toBeNull();
    expect((await load("http://localhost/sign/b1")).next).toBeNull();
  });
});

describe("action", () => {
  const sign = { intent: "sign", fieldValues: JSON.stringify({ f1: "Ada Lovelace" }) };

  it("sends unauthenticated posts to login and records nothing", async () => {
    h.requireAuth.mockResolvedValue({ ok: false });
    const res = await submit(sign);
    expect(res.headers.get("Location")).toBe("/login");
    expect(h.recordSignature).not.toHaveBeenCalled();
  });

  it("ignores any intent other than sign", async () => {
    expect(await submit({ intent: "other" })).toBeNull();
    expect(h.recordSignature).not.toHaveBeenCalled();
  });

  it("rejects unparseable field values", async () => {
    const res = await submit({ intent: "sign", fieldValues: "{not json" });
    expect(res.error).toMatch(/Could not read your inputs/);
    expect(h.recordSignature).not.toHaveBeenCalled();
  });

  it("reports a missing binding", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(null);
    expect(await submit(sign)).toEqual({ error: "Agreement not found." });
  });

  it("refuses a user outside the audience with nothing to countersign", async () => {
    slots({ inAudience: false });
    expect(await submit(sign)).toEqual({ error: "You can't sign this document right now." });
    expect(h.recordSignature).not.toHaveBeenCalled();
  });

  it("refuses to sign twice (already-signed member, or already-countersigned mentee)", async () => {
    slots({ member: "signed" });
    expect((await submit(sign)).error).toMatch(/can't sign/);
    slots({ inAudience: false, mentee: "signed" });
    expect((await submit(sign)).error).toMatch(/can't sign/);
    expect(h.recordSignature).not.toHaveBeenCalled();
  });

  it("records a member signature with the parsed values and redirects to the signed view", async () => {
    const res = await submit(sign);
    expect(h.recordSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: "b1",
        signerUserId: "u1",
        fieldValues: { f1: "Ada Lovelace" },
        roleKey: "member",
        sendReceipt: true,
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/sign/b1");
  });

  it("ignores a client-posted role: the role comes from the server-side slot", async () => {
    slots({ inAudience: false, mentee: "owed" });
    await submit({ ...sign, roleKey: "member", role: "member" });
    expect(h.recordSignature.mock.calls[0][0].roleKey).toBe("mentee");
  });

  it("carries a safe next through the redirect, URL-encoded, and drops an unsafe one", async () => {
    expect((await submit({ ...sign, next: "/projects/p1?a=b" })).headers.get("Location")).toBe(
      "/sign/b1?next=%2Fprojects%2Fp1%3Fa%3Db",
    );
    expect((await submit({ ...sign, next: "//evil.example" })).headers.get("Location")).toBe("/sign/b1");
  });

  it("surfaces a recordSignature failure and sends no follow-up notifications", async () => {
    h.recordSignature.mockResolvedValue({ ok: false, error: "Please complete all required fields before signing." });
    expect(await submit(sign)).toEqual({ error: "Please complete all required fields before signing." });
    expect(h.notifyCountersignRequest).not.toHaveBeenCalled();
    expect(h.sendCoSignedReceipts).not.toHaveBeenCalled();
  });

  describe("receipts and follow-ups", () => {
    it("a member signature asks their mentees to countersign", async () => {
      await submit(sign);
      expect(h.notifyCountersignRequest).toHaveBeenCalledWith("b1", "u1");
      expect(h.sendCoSignedReceipts).not.toHaveBeenCalled();
    });

    it("a mentee countersignature defers its own receipt and sends the co-signed receipts instead", async () => {
      slots({ inAudience: false, mentee: "owed" });
      await submit(sign);
      expect(h.recordSignature.mock.calls[0][0]).toMatchObject({ roleKey: "mentee", sendReceipt: false });
      expect(h.sendCoSignedReceipts).toHaveBeenCalledWith("b1", "u1");
      expect(h.notifyCountersignRequest).not.toHaveBeenCalled();
    });

    it("a mentor with mentees on a countersign document defers the receipt", async () => {
      h.prisma.signingBinding.findUnique.mockResolvedValue({
        ...BINDING,
        document: { ...BINDING.document, requiresMenteeCountersign: true },
      });
      h.prisma.mentorshipPair.count.mockResolvedValue(2);
      await submit(sign);
      expect(h.prisma.mentorshipPair.count).toHaveBeenCalledWith({ where: { mentorUserId: "u1", termId: "t1" } });
      expect(h.recordSignature.mock.calls[0][0].sendReceipt).toBe(false);
    });

    it("a mentor with no mentees, or a document without countersigning, gets the receipt now", async () => {
      h.prisma.signingBinding.findUnique.mockResolvedValue({
        ...BINDING,
        document: { ...BINDING.document, requiresMenteeCountersign: true },
      });
      h.prisma.mentorshipPair.count.mockResolvedValue(0);
      await submit(sign);
      expect(h.recordSignature.mock.calls[0][0].sendReceipt).toBe(true);

      h.prisma.signingBinding.findUnique.mockResolvedValue(BINDING);
      await submit(sign);
      expect(h.recordSignature.mock.calls[1][0].sendReceipt).toBe(true);
    });

    it("a failing follow-up never fails the signature", async () => {
      h.notifyCountersignRequest.mockRejectedValue(new Error("boom"));
      const res = await submit(sign);
      expect(res.headers.get("Location")).toBe("/sign/b1");
    });
  });
});
