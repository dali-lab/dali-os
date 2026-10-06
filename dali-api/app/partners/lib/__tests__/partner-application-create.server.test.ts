import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db");

vi.mock("~/partners/lib/partner-activity.server", () => ({
  logPartnerActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/partners/lib/partner-notify.server", () => ({
  notifyPartners: vi.fn().mockResolvedValue({ inApp: 0, emailed: 0, slackDmed: 0 }),
}));

import { prisma } from "~/lib/db";
import { logPartnerActivity } from "~/partners/lib/partner-activity.server";
import { notifyPartners } from "~/partners/lib/partner-notify.server";
import { createPartnerApplication } from "../partner-application-create.server";

const db = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  db.partnerContact.upsert.mockResolvedValue({ id: "contact-1" });
  db.partnerApplication.aggregate.mockResolvedValue({ _min: { position: null } });
  db.partnerApplication.create.mockResolvedValue({ id: "app-1" });
});

describe("createPartnerApplication", () => {
  it("requires a title", async () => {
    const result = await createPartnerApplication({
      title: "   ",
      applicantEmail: "a@b.com",
      actorUserId: "u1",
    });
    expect(result).toEqual({ error: "A title is required." });
    expect(db.partnerApplication.create).not.toHaveBeenCalled();
  });

  it("requires a valid applicant email", async () => {
    const result = await createPartnerApplication({
      title: "A pitch",
      applicantEmail: "not-an-email",
      actorUserId: "u1",
    });
    expect(result).toEqual({ error: "A valid applicant email is required." });
    expect(db.partnerApplication.create).not.toHaveBeenCalled();
  });

  it("upserts the contact by lowercased email, creates the application at the top of New, logs Created, and notifies Core", async () => {
    db.partnerApplication.aggregate.mockResolvedValue({ _min: { position: 3 } });
    const result = await createPartnerApplication({
      title: "  New pitch  ",
      applicantName: "Jane Smith",
      applicantEmail: "Jane@Example.com",
      summary: "  A summary  ",
      source: "Referral",
      targetTermIds: ["t1", "t1", " "],
      domainIds: ["d1"],
      actorUserId: "u1",
    });

    expect(result).toEqual({ id: "app-1" });

    expect(db.partnerContact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "jane@example.com" },
        create: expect.objectContaining({ email: "jane@example.com", name: "Jane Smith", userId: null }),
      }),
    );

    expect(db.partnerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "New pitch",
          applicantContactId: "contact-1",
          partnerOrgId: null,
          stage: "New",
          position: 2, // one below the column's current minimum (3 - 1)
          source: "Referral",
          summary: "A summary",
          targetTerms: { create: [{ termId: "t1" }] },
          domains: { create: [{ domainId: "d1" }] },
        }),
      }),
    );

    expect(logPartnerActivity).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        applicationId: "app-1",
        actorUserId: "u1",
        type: "Created",
        metadata: { source: "Referral" },
      }),
    );

    expect(notifyPartners).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "partner.inquiry_received",
        link: "/core/partners?application=app-1",
      }),
    );
  });

  it("lands at position 0 when New is empty", async () => {
    db.partnerApplication.aggregate.mockResolvedValue({ _min: { position: null } });
    await createPartnerApplication({
      title: "First one",
      applicantEmail: "a@b.com",
      actorUserId: "u1",
    });
    expect(db.partnerApplication.create.mock.calls[0][0].data.position).toBe(0);
  });

  it("falls back to Manual for a missing or invalid source", async () => {
    await createPartnerApplication({
      title: "No source given",
      applicantEmail: "a@b.com",
      source: "NotARealSource",
      actorUserId: "u1",
    });
    expect(db.partnerApplication.create.mock.calls[0][0].data.source).toBe("Manual");
  });

  it("falls back to the email's local part when no applicant name is given", async () => {
    await createPartnerApplication({
      title: "No name given",
      applicantEmail: "someone@example.com",
      actorUserId: "u1",
    });
    expect(db.partnerContact.upsert.mock.calls[0][0].create.name).toBe("someone");
  });
});
