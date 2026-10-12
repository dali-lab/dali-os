import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/partners/lib/partner-activity.server", () => ({ logPartnerActivity: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { action } from "~/partners/routes/core.partners.contacts.$contactId";

const db = prisma as unknown as Record<string, any>;
const CONTACT_ID = "contact-1";

function callAction(fields: Record<string, string>) {
  const form = new URLSearchParams(fields);
  const request = new Request(`http://localhost/core/partners/contacts/${CONTACT_ID}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  return action({ request, params: { contactId: CONTACT_ID }, context: {} } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "core-1", type: "member" },
  } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  db.partnerContact.findUnique.mockResolvedValue({ id: CONTACT_ID });
});

describe("contact route action — guards", () => {
  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = await callAction({ intent: "contact-details", name: "Jo", email: "jo@acme.com" });
    expect(res).toMatchObject({ error: expect.stringContaining("permission") });
    expect(db.partnerContact.update).not.toHaveBeenCalled();
  });
});

describe("contact-details", () => {
  it("requires a name", async () => {
    const res = await callAction({ intent: "contact-details", name: "", email: "jo@acme.com" });
    expect(res).toMatchObject({ error: expect.stringContaining("name") });
  });

  it("requires a valid email", async () => {
    const res = await callAction({ intent: "contact-details", name: "Jo", email: "not-an-email" });
    expect(res).toMatchObject({ error: expect.stringContaining("email") });
  });

  it("saves the contact's fields", async () => {
    db.partnerContact.update.mockResolvedValue({});
    const res = await callAction({
      intent: "contact-details",
      name: "Jo",
      email: "jo@acme.com",
      title: "CTO",
      preferredChannel: "Slack",
    });
    expect(res).toEqual({ ok: true });
    expect(db.partnerContact.update).toHaveBeenCalledWith({
      where: { id: CONTACT_ID },
      data: {
        name: "Jo",
        email: "jo@acme.com",
        title: "CTO",
        phone: null,
        linkedinUrl: null,
        affiliation: null,
        notes: null,
        preferredChannel: "Slack",
      },
    });
  });

  it("surfaces a duplicate email as a friendly error instead of throwing", async () => {
    db.partnerContact.update.mockRejectedValue({ code: "P2002" });
    const res = await callAction({
      intent: "contact-details",
      name: "Jo",
      email: "taken@acme.com",
    });
    expect(res).toMatchObject({ error: expect.stringContaining("already uses that email") });
  });
});

describe("note", () => {
  it("requires a body", async () => {
    const res = await callAction({ intent: "note", body: "   " });
    expect(res).toMatchObject({ error: expect.stringContaining("empty") });
  });

  it("logs a contact-scoped Note activity", async () => {
    const { logPartnerActivity } = await import("~/partners/lib/partner-activity.server");
    const res = await callAction({ intent: "note", body: "Called them back." });
    expect(res).toEqual({ ok: true });
    expect(logPartnerActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        contactId: CONTACT_ID,
        actorUserId: "core-1",
        type: "Note",
        body: "Called them back.",
      }),
    );
  });
});
