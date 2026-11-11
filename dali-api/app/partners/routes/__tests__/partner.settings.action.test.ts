import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async () => null) }));
vi.mock("~/partners/lib/partner-auth.server", () => ({ requirePartnerAccount: vi.fn() }));
vi.mock("~/partners/lib/invites.server", () => ({
  createPartnerInvite: vi.fn(async () => ({ ok: true })),
  revokePartnerInvite: vi.fn(async () => ({ ok: true })),
  listPendingInvites: vi.fn(async () => []),
}));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { createPartnerInvite, revokePartnerInvite } from "~/partners/lib/invites.server";
import { action, loader } from "~/partners/routes/partner.settings";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
  $transaction: ReturnType<typeof vi.fn>;
};

function membership(
  id: string,
  orgId: string,
  opts: { primaryContactId?: string | null; isIndividual?: boolean; name?: string } = {},
) {
  return {
    id,
    orgId,
    role: null,
    org: {
      id: orgId,
      name: opts.name ?? "Acme",
      logoUrl: null,
      website: null,
      isIndividual: opts.isIndividual ?? false,
      primaryContactId: opts.primaryContactId === undefined ? id : opts.primaryContactId,
    },
  };
}

function signIn(memberships: ReturnType<typeof membership>[], name = "Ada Lovelace") {
  vi.mocked(requirePartnerAccount).mockResolvedValue({
    auth: { user: { sub: "u1" } },
    contact: { id: "c1", name, email: "ada@example.com", userId: "u1" },
    memberships,
  } as never);
}

function post(fields: Record<string, string>) {
  const request = new Request("http://localhost/partner/settings", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return action({ request, params: {}, context: {} } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockResolvedValue([]);
  db.partnerMembership.findFirst.mockResolvedValue({ id: "m2" });
  signIn([membership("m1", "org1")]);
});

describe("partner settings: profile", () => {
  it("saves the profile and keeps the contact name in sync", async () => {
    const res = await post({
      intent: "profile",
      firstName: " Ada ",
      lastName: "Lovelace",
      pronouns: "she/her",
      timeZone: "America/Chicago",
    });
    expect(res).toEqual({ ok: true, intent: "profile" });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { firstName: "Ada", lastName: "Lovelace", pronouns: "she/her", timeZone: "America/Chicago", photoUrl: null },
    });
    expect(db.partnerContact.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { name: "Ada Lovelace" },
    });
  });

  it("accepts a single name", async () => {
    const res = await post({ intent: "profile", firstName: "Oye", lastName: "" });
    expect(res).toEqual({ ok: true, intent: "profile" });
    expect(db.partnerContact.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { name: "Oye" } });
  });

  it("leaves an unset time zone unset", async () => {
    await post({ intent: "profile", firstName: "Ada", timeZone: "" });
    expect(db.user.update.mock.calls[0][0].data.timeZone).toBeNull();
  });

  it("rejects a missing first name and a bad time zone", async () => {
    expect(await post({ intent: "profile", firstName: "", lastName: "L" })).toEqual({
      ok: false,
      error: "Enter your name.",
    });
    expect(await post({ intent: "profile", firstName: "Ada", timeZone: "Mars/Base" })).toEqual({
      ok: false,
      error: "Choose a valid time zone.",
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("works for a partner with no org", async () => {
    signIn([]);
    expect(await post({ intent: "profile", firstName: "Ada" })).toEqual({ ok: true, intent: "profile" });
  });
});

describe("partner settings: organization", () => {
  it("saves the org the form names, with the caller's role", async () => {
    signIn([membership("m1", "org1"), membership("m9", "org2", { name: "Beta" })]);
    const res = await post({ intent: "org", orgId: "org2", name: "Beta Labs", website: "beta.org", role: "CTO" });
    expect(res).toEqual({ ok: true, intent: "org" });
    expect(db.partnerOrg.update).toHaveBeenCalledWith({
      where: { id: "org2" },
      data: { name: "Beta Labs", website: "https://beta.org", logoUrl: null },
    });
    expect(db.partnerMembership.update).toHaveBeenCalledWith({ where: { id: "m9" }, data: { role: "CTO" } });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "partner.org.update", targetId: "org2" }),
    );
  });

  it("lets any member edit, not only the primary contact", async () => {
    signIn([membership("m1", "org1", { primaryContactId: "m2" })]);
    expect(await post({ intent: "org", orgId: "org1", name: "Acme" })).toEqual({ ok: true, intent: "org" });
  });

  it("keeps a website that already has a scheme", async () => {
    await post({ intent: "org", orgId: "org1", name: "Acme", website: "http://acme.com/about" });
    expect(db.partnerOrg.update.mock.calls[0][0].data.website).toBe("http://acme.com/about");
  });

  it.each(["javascript:alert(1)", "not a site", "localhost"])("rejects the website %s", async (website) => {
    expect(await post({ intent: "org", orgId: "org1", name: "Acme", website })).toEqual({
      ok: false,
      error: "Enter a website like example.com.",
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("requires a name", async () => {
    expect(await post({ intent: "org", orgId: "org1", name: " " })).toEqual({
      ok: false,
      error: "Enter the organization's name.",
    });
  });

  it("refuses an org the caller isn't in", async () => {
    expect(await post({ intent: "org", orgId: "other", name: "X" })).toEqual({
      ok: false,
      error: "Organization not found.",
    });
    expect(db.partnerOrg.update).not.toHaveBeenCalled();
  });

  it("refuses an individual partner's own org", async () => {
    signIn([membership("m1", "org1", { isIndividual: true })]);
    expect(await post({ intent: "org", orgId: "org1", name: "X" })).toEqual({
      ok: false,
      error: "Organization not found.",
    });
    expect(await post({ intent: "invite", orgId: "org1", email: "b@example.com" })).toEqual({
      ok: false,
      error: "Organization not found.",
    });
    expect(createPartnerInvite).not.toHaveBeenCalled();
  });
});

describe("partner settings: primary contact", () => {
  it("lets the primary contact hand it to another member", async () => {
    const res = await post({ intent: "set-primary", orgId: "org1", membershipId: "m2" });
    expect(res).toEqual({ ok: true, intent: "set-primary" });
    expect(db.partnerOrg.update).toHaveBeenCalledWith({ where: { id: "org1" }, data: { primaryContactId: "m2" } });
    expect(db.partnerMembership.findFirst).toHaveBeenCalledWith({
      where: { id: "m2", orgId: "org1", endedAt: null },
      select: { id: true },
    });
  });

  it("lets anyone claim it when the org has none", async () => {
    signIn([membership("m1", "org1", { primaryContactId: null })]);
    expect(await post({ intent: "set-primary", orgId: "org1", membershipId: "m1" })).toEqual({
      ok: true,
      intent: "set-primary",
    });
  });

  it("refuses a member who isn't the primary contact", async () => {
    signIn([membership("m1", "org1", { primaryContactId: "m2" })]);
    expect(await post({ intent: "set-primary", orgId: "org1", membershipId: "m1" })).toEqual({
      ok: false,
      error: "Only the primary contact can change this.",
    });
    expect(db.partnerOrg.update).not.toHaveBeenCalled();
  });

  it("refuses a target outside the org", async () => {
    db.partnerMembership.findFirst.mockResolvedValue(null);
    expect(await post({ intent: "set-primary", orgId: "org1", membershipId: "elsewhere" })).toEqual({
      ok: false,
      error: "Member not found.",
    });
  });
});

describe("partner settings: removing members", () => {
  it("lets the primary contact end another member's membership", async () => {
    const res = await post({ intent: "remove-member", orgId: "org1", membershipId: "m2" });
    expect(res).toEqual({ ok: true, intent: "remove-member" });
    expect(db.partnerMembership.update).toHaveBeenCalledWith({
      where: { id: "m2" },
      data: { endedAt: expect.any(Date) },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "partner.member.remove", metadata: { membershipId: "m2" } }),
    );
  });

  it("refuses a member who isn't the primary contact", async () => {
    signIn([membership("m1", "org1", { primaryContactId: "m3" })]);
    expect(await post({ intent: "remove-member", orgId: "org1", membershipId: "m2" })).toEqual({
      ok: false,
      error: "Only the primary contact can remove members.",
    });
    expect(db.partnerMembership.update).not.toHaveBeenCalled();
  });

  it("refuses when the org has no primary contact", async () => {
    signIn([membership("m1", "org1", { primaryContactId: null })]);
    expect(await post({ intent: "remove-member", orgId: "org1", membershipId: "m2" })).toEqual({
      ok: false,
      error: "Only the primary contact can remove members.",
    });
  });

  it("refuses removing yourself", async () => {
    db.partnerMembership.findFirst.mockResolvedValue({ id: "m1" });
    expect(await post({ intent: "remove-member", orgId: "org1", membershipId: "m1" })).toEqual({
      ok: false,
      error: "You can't remove yourself.",
    });
    expect(db.partnerMembership.update).not.toHaveBeenCalled();
  });
});

describe("partner settings: invites", () => {
  it("lets any member invite to their org", async () => {
    signIn([membership("m1", "org1", { primaryContactId: "m2" })]);
    const res = await post({ intent: "invite", orgId: "org1", email: "b@example.com", displayRole: "PM" });
    expect(res).toEqual({ ok: true, intent: "invite" });
    expect(createPartnerInvite).toHaveBeenCalledWith(
      { partnerOrgId: "org1", email: "b@example.com", displayRole: "PM", invitedByUserId: "u1" },
      expect.any(Request),
    );
  });

  it("passes an invite error through", async () => {
    vi.mocked(createPartnerInvite).mockResolvedValue({ error: "Already invited." } as never);
    expect(await post({ intent: "invite", orgId: "org1", email: "b@example.com" })).toEqual({
      ok: false,
      error: "Already invited.",
    });
  });

  it("revokes an invite scoped to the caller's org", async () => {
    const res = await post({ intent: "revoke-invite", orgId: "org1", inviteId: "inv1" });
    expect(res).toEqual({ ok: true, intent: "revoke-invite" });
    expect(revokePartnerInvite).toHaveBeenCalledWith(
      { inviteId: "inv1", partnerOrgId: "org1", actorUserId: "u1" },
      expect.any(Request),
    );
  });

  it("rejects an unknown intent", async () => {
    expect(await post({ intent: "nope", orgId: "org1" })).toEqual({ ok: false, error: "Unknown action." });
  });
});

describe("partner settings loader", () => {
  const load = () =>
    loader({ request: new Request("http://localhost/partner/settings"), params: {}, context: {} } as never);

  it("lists team orgs only, skipping individual ones", async () => {
    signIn([
      membership("m0", "solo", { isIndividual: true, name: "Ada Lovelace" }),
      membership("m1", "org1"),
      membership("m9", "org2", { name: "Beta" }),
    ]);
    db.user.findUnique.mockResolvedValue({ firstName: "Ada", lastName: "Lovelace", photoUrl: null, pronouns: null, timeZone: null });
    db.partnerMembership.findMany.mockResolvedValue([]);
    const data = await load();
    expect(data.orgs.map((o) => o.id)).toEqual(["org1", "org2"]);
    expect(data.orgs[1].myMembershipId).toBe("m9");
  });

  it("reports reply emails on by default for partners", async () => {
    signIn([]);
    db.user.findUnique.mockResolvedValue({ firstName: "Ada", lastName: "", photoUrl: null, pronouns: null, timeZone: null });
    db.notificationPreference.findUnique.mockResolvedValue(null);
    expect((await load()).replies).toEqual({ inApp: true, email: true });
  });

  it("reports reply emails off once the partner turns them off", async () => {
    signIn([]);
    db.user.findUnique.mockResolvedValue({ firstName: "Ada", lastName: "", photoUrl: null, pronouns: null, timeZone: null });
    db.notificationPreference.findUnique.mockResolvedValue({ inApp: true, digestFrequency: "Off" });
    expect((await load()).replies).toEqual({ inApp: true, email: false });
  });

  it("falls back to the contact name when the user has no first name", async () => {
    signIn([], "Mary Ann Smith");
    db.user.findUnique.mockResolvedValue({ firstName: "", lastName: "", photoUrl: null, pronouns: null, timeZone: null });
    const data = await load();
    expect(data.me).toMatchObject({ firstName: "Mary", lastName: "Ann Smith", timeZone: null });
  });
});
