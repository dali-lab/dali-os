import { describe, it, expect, vi, beforeEach } from "vitest";

const tx = vi.hoisted(() => ({
  partnerOrg: { update: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
  partnerMembership: { update: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  partnerInvite: { deleteMany: vi.fn(), updateMany: vi.fn() },
  partnerApplication: { updateMany: vi.fn() },
  partnerActivity: { updateMany: vi.fn() },
  partnerInvoice: { updateMany: vi.fn() },
  projectPartner: { updateMany: vi.fn(), deleteMany: vi.fn() },
  partnerContact: { update: vi.fn(), upsert: vi.fn() },
}));

vi.mock("~/lib/db.server", () => ({
  prisma: {
    partnerOrg: { findUnique: vi.fn(), update: vi.fn() },
    partnerContact: { findUnique: vi.fn() },
    partnerMembership: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), count: vi.fn() },
    projectPartner: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    partnerApplication: { count: vi.fn() },
    partnerInvite: { count: vi.fn() },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("../partner-activity.server", () => ({ logPartnerActivity: vi.fn() }));
vi.mock("../partner-finance.server", () => ({ upsertInvoice: vi.fn(), setInvoiceStatus: vi.fn() }));
vi.mock("../partner-access", () => ({
  linkProjectPartner: vi.fn(),
  unlinkProjectPartner: vi.fn(),
  updateProjectPartnerDates: vi.fn(),
}));
vi.mock("../invites.server", () => ({
  createPartnerInvite: vi.fn(),
  revokePartnerInvite: vi.fn(),
}));
vi.mock("../magic-link.server", () => ({
  classifyPartnerEmail: vi.fn(),
  issuePartnerMagicLink: vi.fn(),
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
}));

import { prisma } from "~/lib/db.server";
import { logPartnerActivity } from "../partner-activity.server";
import { setInvoiceStatus, upsertInvoice } from "../partner-finance.server";
import {
  linkProjectPartner,
  updateProjectPartnerDates,
} from "../partner-access";
import { createPartnerInvite } from "../invites.server";
import { classifyPartnerEmail, issuePartnerMagicLink } from "../magic-link.server";
import { PARTNER_ORG_ACTIONS, runPartnerOrgAction } from "../org-actions.server";

const db = prisma as any;
const org = { id: "org1", name: "Acme", primaryContactId: "m-primary", isIndividual: false };

function run(intent: string, fields: Record<string, string> = {}, over: Partial<typeof org> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const request = new Request("http://localhost/core/partners/orgs/org1");
  return runPartnerOrgAction(
    {
      form,
      org: { ...org, ...over },
      userId: "u1",
      request,
      actor: { actorUserId: "u1", request },
    },
    intent,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
});

describe("runPartnerOrgAction", () => {
  it("rejects an unknown intent", async () => {
    expect(await run("nope")).toEqual({ error: "Unknown action." });
  });

  it("does not treat prototype keys as intents", async () => {
    expect(await run("toString")).toEqual({ error: "Unknown action." });
  });

  it("registers every intent the page posts", () => {
    expect(Object.keys(PARTNER_ORG_ACTIONS).sort()).toEqual(
      [
        "invite", "invoice-save", "invoice-status", "member-add", "member-move",
        "member-remove", "member-role", "member-set-primary", "note", "org-delete",
        "org-details", "org-merge", "project-end", "project-link", "project-unlink",
        "revoke-invite", "send-signin-link",
      ].sort(),
    );
  });
});

describe("member intents", () => {
  it("member-add refuses a missing contact id and an unknown contact", async () => {
    expect(await run("member-add")).toEqual({ error: "Choose a contact to add." });
    db.partnerContact.findUnique.mockResolvedValue(null);
    expect(await run("member-add", { contactId: "c1" })).toEqual({ error: "Contact not found." });
  });

  it("member-add upserts on the contact and org pair so a removed member returns", async () => {
    db.partnerContact.findUnique.mockResolvedValue({ id: "c1" });
    expect(await run("member-add", { contactId: "c1" })).toEqual({ ok: true });
    expect(db.partnerMembership.upsert).toHaveBeenCalledWith({
      where: { contactId_orgId: { contactId: "c1", orgId: "org1" } },
      create: { contactId: "c1", orgId: "org1" },
      update: { endedAt: null },
    });
    expect(logPartnerActivity).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ type: "MemberAdded", orgId: "org1" }),
    );
  });

  it("member-move refuses a target org that does not exist", async () => {
    db.partnerMembership.findFirst.mockResolvedValue({ id: "m1", contactId: "c1" });
    db.partnerOrg.findUnique.mockResolvedValue(null);
    expect(await run("member-move", { partnerUserId: "m1", targetOrgId: "org2" })).toEqual({
      error: "That organization no longer exists.",
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("member-move refuses the same org and a missing target", async () => {
    expect(await run("member-move", { partnerUserId: "m1" })).toEqual({
      error: "Choose an organization to move them to.",
    });
    expect(await run("member-move", { partnerUserId: "m1", targetOrgId: "org1" })).toEqual({
      error: "They're already in this organization.",
    });
  });

  it("member-move ends the old membership, opens one in the target, and drops the primary", async () => {
    db.partnerMembership.findFirst.mockResolvedValue({ id: "m-primary", contactId: "c1" });
    db.partnerOrg.findUnique.mockResolvedValue({ id: "org2" });
    expect(await run("member-move", { partnerUserId: "m-primary", targetOrgId: "org2" })).toEqual({
      ok: true,
    });
    expect(tx.partnerOrg.update).toHaveBeenCalledWith({
      where: { id: "org1" },
      data: { primaryContactId: null },
    });
    expect(tx.partnerMembership.create).toHaveBeenCalledWith({
      data: { contactId: "c1", orgId: "org2" },
    });
  });

  it("member-remove soft-ends the membership and clears the primary", async () => {
    db.partnerMembership.findFirst.mockResolvedValue({ id: "m-primary" });
    expect(await run("member-remove", { partnerUserId: "m-primary" })).toEqual({ ok: true });
    expect(tx.partnerMembership.update).toHaveBeenCalledWith({
      where: { id: "m-primary" },
      data: { endedAt: expect.any(Date) },
    });
    expect(tx.partnerOrg.update).toHaveBeenCalled();
  });

  it("member-remove refuses a member of another org", async () => {
    db.partnerMembership.findFirst.mockResolvedValue(null);
    expect(await run("member-remove", { partnerUserId: "m9" })).toEqual({
      error: "Member not found.",
    });
  });

  it("member-role refuses when no active member matches", async () => {
    db.partnerMembership.updateMany.mockResolvedValue({ count: 0 });
    expect(await run("member-role", { partnerUserId: "m1", displayRole: "CTO" })).toEqual({
      error: "Member not found.",
    });
  });

  it("member-set-primary refuses a member outside the org", async () => {
    db.partnerMembership.findFirst.mockResolvedValue(null);
    expect(await run("member-set-primary", { membershipId: "m1" })).toEqual({
      error: "Member not found.",
    });
    expect(db.partnerOrg.update).not.toHaveBeenCalled();
  });
});

describe("send-signin-link", () => {
  it("refuses when the partner has no contact email", async () => {
    db.partnerMembership.findFirst.mockResolvedValue(null);
    expect(await run("send-signin-link")).toEqual({
      error: "This partner has no contact email yet.",
    });
  });

  it("reports rate limiting", async () => {
    db.partnerMembership.findFirst.mockResolvedValue({ contact: { email: "a@example.org" } });
    vi.mocked(issuePartnerMagicLink).mockResolvedValue({ rateLimited: true } as never);
    expect(await run("send-signin-link")).toEqual({
      error: "Too many sign-in links were just sent. Try again in a few minutes.",
    });
  });
});

describe("project intents", () => {
  it("project-link requires a project and passes the org", async () => {
    expect(await run("project-link")).toEqual({ error: "Select a project." });
    vi.mocked(linkProjectPartner).mockResolvedValue({ ok: true } as never);
    expect(await run("project-link", { projectId: "p1" })).toEqual({ ok: true });
    expect(linkProjectPartner).toHaveBeenCalledWith(
      { projectId: "p1", partnerOrgId: "org1" },
      expect.objectContaining({ actorUserId: "u1" }),
    );
  });

  it("project-end stamps endedAt and keeps startedAt", async () => {
    const startedAt = new Date("2026-01-01");
    db.projectPartner.findFirst.mockResolvedValue({ startedAt, projectId: "p1" });
    vi.mocked(updateProjectPartnerDates).mockResolvedValue({ ok: true } as never);
    expect(await run("project-end", { projectPartnerId: "pp1" })).toEqual({ ok: true });
    expect(updateProjectPartnerDates).toHaveBeenCalledWith(
      { projectPartnerId: "pp1", startedAt, endedAt: expect.any(Date) },
      expect.anything(),
    );
    expect(logPartnerActivity).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ type: "ProjectEnded", metadata: { projectId: "p1" } }),
    );
  });

  it("project-end refuses a link that belongs to another org", async () => {
    db.projectPartner.findFirst.mockResolvedValue(null);
    expect(await run("project-end", { projectPartnerId: "pp9" })).toEqual({
      error: "Partnership not found.",
    });
  });
});

describe("invite", () => {
  it("sends through the invite service and flags invited", async () => {
    vi.mocked(createPartnerInvite).mockResolvedValue({ ok: true } as never);
    expect(await run("invite", { email: "ada@example.org", displayRole: " Lead " })).toEqual({
      ok: true,
      invited: true,
    });
    expect(createPartnerInvite).toHaveBeenCalledWith(
      { partnerOrgId: "org1", email: "ada@example.org", displayRole: "Lead", invitedByUserId: "u1" },
      expect.any(Request),
    );
  });

  it("passes the service error through", async () => {
    vi.mocked(createPartnerInvite).mockResolvedValue({ error: "Already invited." } as never);
    expect(await run("invite", { email: "ada@example.org" })).toEqual({ error: "Already invited." });
  });
});

describe("org-details", () => {
  it("requires a name and a real referrer", async () => {
    expect(await run("org-details", { name: " " })).toEqual({ error: "A name is required." });
    db.partnerContact.findUnique.mockResolvedValue(null);
    expect(await run("org-details", { name: "Acme", referredByContactId: "c9" })).toEqual({
      error: "Referred-by contact not found.",
    });
  });

  it("drops an invalid type and normalizes tags", async () => {
    expect(
      await run("org-details", { name: "Acme", type: "bogus", tags: " a, ,b ", website: " x.org " }),
    ).toEqual({ ok: true });
    expect(db.partnerOrg.update).toHaveBeenCalledWith({
      where: { id: "org1" },
      data: expect.objectContaining({
        name: "Acme",
        type: null,
        tags: ["a", "b"],
        website: "x.org",
        isIndividual: false,
        primaryContactId: null,
      }),
    });
  });

  it("requires the primary contact to be an active member", async () => {
    db.partnerMembership.findFirst.mockResolvedValue(null);
    expect(await run("org-details", { name: "Acme", primaryContactId: "m9" })).toEqual({
      error: "Primary contact must belong to this organization.",
    });
  });

  it("individuals need an email and cannot use a member address", async () => {
    expect(await run("org-details", { name: "Ada", isIndividual: "on", email: "nope" })).toEqual({
      error: "An email is required for an individual partner.",
    });
    vi.mocked(classifyPartnerEmail).mockResolvedValue({ kind: "member-conflict" } as never);
    const res = await run("org-details", { name: "Ada", isIndividual: "on", email: "a@dartmouth.edu" });
    expect(res).toEqual({ error: expect.stringContaining("belongs to a DALI member") });
  });

  it("an individual keeps name and email on the sole contact", async () => {
    vi.mocked(classifyPartnerEmail).mockResolvedValue({ kind: "new" } as never);
    db.partnerMembership.findFirst.mockResolvedValue({ id: "m1", contactId: "c1" });
    expect(
      await run("org-details", { name: "Ada", isIndividual: "on", email: "Ada@Example.org" }),
    ).toEqual({ ok: true });
    expect(tx.partnerContact.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { name: "Ada", email: "ada@example.org" },
    });
    expect(tx.partnerOrg.update).toHaveBeenCalledWith({
      where: { id: "org1" },
      data: expect.objectContaining({ isIndividual: true, website: null, logoUrl: null }),
    });
  });

  it("maps an email collision to a message", async () => {
    vi.mocked(classifyPartnerEmail).mockResolvedValue({ kind: "new" } as never);
    db.partnerMembership.findFirst.mockResolvedValue({ id: "m1", contactId: "c1" });
    db.$transaction.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(
      await run("org-details", { name: "Ada", isIndividual: "on", email: "ada@example.org" }),
    ).toEqual({ error: "Another partner already uses that email address." });
  });
});

describe("org-delete", () => {
  function counts(members: number, projects: number, apps: number, invites: number) {
    db.partnerMembership.count.mockResolvedValue(members);
    db.projectPartner.count.mockResolvedValue(projects);
    db.partnerApplication.count.mockResolvedValue(apps);
    db.partnerInvite.count.mockResolvedValue(invites);
  }

  it("refuses an org that still has members, projects, applications or invites", async () => {
    for (const c of [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] as [number, number, number, number][]) {
      counts(c[0], c[1], c[2], c[3]);
      expect(await run("org-delete")).toEqual({
        error: expect.stringContaining("Only an empty organization"),
      });
    }
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("deletes an empty org and redirects to the directory", async () => {
    counts(0, 0, 0, 0);
    const res = (await run("org-delete")) as Response;
    expect(tx.partnerInvite.deleteMany).toHaveBeenCalledWith({ where: { partnerOrgId: "org1" } });
    expect(tx.partnerOrg.delete).toHaveBeenCalledWith({ where: { id: "org1" } });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/core/partners/directory");
  });

  it("an individual's own membership does not block deletion", async () => {
    counts(1, 0, 0, 0);
    const res = (await run("org-delete", {}, { isIndividual: true })) as Response;
    expect(res.status).toBe(302);
  });
});

describe("org-merge", () => {
  it("validates the survivor", async () => {
    expect(await run("org-merge")).toEqual({ error: "Choose an organization to merge into." });
    expect(await run("org-merge", { survivorOrgId: "org1" })).toEqual({
      error: "Choose a different organization to merge into.",
    });
    db.partnerOrg.findUnique.mockResolvedValue(null);
    expect(await run("org-merge", { survivorOrgId: "org2" })).toEqual({
      error: "That organization no longer exists.",
    });
  });

  it("moves members, projects and history to the survivor, then deletes the source", async () => {
    db.partnerOrg.findUnique.mockResolvedValue({ id: "org2" });
    db.partnerMembership.findMany
      .mockResolvedValueOnce([{ id: "m1", contactId: "c1" }])
      .mockResolvedValueOnce([]);
    db.projectPartner.findMany
      .mockResolvedValueOnce([{ id: "pp1", projectId: "p1" }])
      .mockResolvedValueOnce([]);
    const res = (await run("org-merge", { survivorOrgId: "org2" })) as Response;
    expect(tx.partnerMembership.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1"] } },
      data: { orgId: "org2" },
    });
    expect(tx.projectPartner.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["pp1"] } },
      data: { partnerOrgId: "org2" },
    });
    expect(tx.partnerInvoice.updateMany).toHaveBeenCalledWith({
      where: { orgId: "org1" },
      data: { orgId: "org2" },
    });
    expect(tx.partnerOrg.delete).toHaveBeenCalledWith({ where: { id: "org1" } });
    expect(res.headers.get("Location")).toBe("/core/partners/orgs/org2");
  });
});

describe("note and invoices", () => {
  it("note rejects an empty body and logs a trimmed one", async () => {
    expect(await run("note", { body: "  " })).toEqual({ error: "Note can't be empty." });
    expect(await run("note", { body: " Called them " })).toEqual({ ok: true });
    expect(logPartnerActivity).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ type: "Note", body: "Called them" }),
    );
  });

  it("invoice-save rejects a bad amount and converts dollars to cents", async () => {
    expect(await run("invoice-save", { amount: "abc" })).toEqual({
      error: "Enter a valid invoice amount.",
    });
    expect(await run("invoice-save", { amount: "-1" })).toEqual({
      error: "Enter a valid invoice amount.",
    });
    expect(await run("invoice-save", { amount: "12.34", reference: " INV-1 " })).toEqual({ ok: true });
    expect(upsertInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org1", amountCents: 1234, reference: "INV-1", issuedAt: null }),
    );
  });

  it("invoice-status rejects a status outside the enum", async () => {
    expect(await run("invoice-status", { invoiceId: "i1", status: "Bogus" })).toEqual({
      error: "Invalid invoice status update.",
    });
    expect(setInvoiceStatus).not.toHaveBeenCalled();
  });

  it("invoice-status passes the actor and surfaces service errors", async () => {
    vi.mocked(setInvoiceStatus).mockResolvedValueOnce({ error: "Not found." } as never);
    expect(await run("invoice-status", { invoiceId: "i1", status: "Paid" })).toEqual({
      error: "Not found.",
    });
    vi.mocked(setInvoiceStatus).mockResolvedValueOnce({ ok: true } as never);
    expect(await run("invoice-status", { invoiceId: "i1", status: "Paid" })).toEqual({ ok: true });
    expect(setInvoiceStatus).toHaveBeenCalledWith({
      invoiceId: "i1",
      status: "Paid",
      actorUserId: "u1",
    });
  });
});
