import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/partners/lib/partner-auth.server", () => ({ requirePartnerAccount: vi.fn() }));
vi.mock("~/partners/lib/application-form.server", () => ({ loadApplicationForm: vi.fn() }));
vi.mock("~/forms/lib/public-form", () => ({ validateAnswers: vi.fn() }));
vi.mock("~/forms/lib/submission-notify.server", () => ({ notifyFormSubmission: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/partners/lib/partner-activity.server", () => ({ logPartnerActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/partners/lib/partner-notify.server", () => ({ notifyPartners: vi.fn().mockResolvedValue({ inApp: 0, emailed: 0, slackDmed: 0 }) }));
vi.mock("~/partners/lib/partner-emails.server", () => ({ sendApplicationReceivedEmail: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { loadApplicationForm } from "~/partners/lib/application-form.server";
import { validateAnswers } from "~/forms/lib/public-form";
import { notifyFormSubmission } from "~/forms/lib/submission-notify.server";
import { notifyPartners } from "~/partners/lib/partner-notify.server";
import { sendApplicationReceivedEmail } from "~/partners/lib/partner-emails.server";
import { action } from "~/partners/routes/partner.apply";

const db = prisma as unknown as Record<string, any>;

const QUESTIONS = [{ key: "pitch", type: "text", data: { label: "Pitch" } }];
const FORM = {
  formId: "form-1",
  name: "Application",
  versionId: "ver-1",
  versionUpdatedAt: "2026-01-01T00:00:00.000Z",
  description: null,
  questions: QUESTIONS,
};

function callAction(answers: Record<string, unknown>) {
  const form = new FormData();
  form.set("formAnswers", JSON.stringify(answers));
  form.set("formVersionUpdatedAt", FORM.versionUpdatedAt);
  const request = new Request("http://localhost/partner/apply", { method: "POST", body: form });
  return action({ request, params: {}, context: {} } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  (requirePartnerAccount as any).mockResolvedValue({
    auth: { user: { sub: "user-1" } },
    contact: { id: "contact-1", name: "Jane Smith", email: "jane@example.com" },
  });
  (loadApplicationForm as any).mockResolvedValue(FORM);
  (validateAnswers as any).mockResolvedValue(null);
  db.formSubmission.create.mockResolvedValue({ id: "sub-1" });
  db.partnerApplication.create.mockResolvedValue({ id: "app-1" });
  db.$transaction.mockImplementation((fn: (tx: any) => Promise<any>) => fn(db));
});

describe("partner.apply action", () => {
  it("notifies Core of the new inquiry with a board deep link", async () => {
    const res = (await callAction({ pitch: "We'd love to build a kiosk" })) as Response;
    expect(res.status).toBe(302);
    expect(notifyPartners).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "partner.inquiry_received",
        title: expect.stringContaining("We'd love to build a kiosk"),
        body: "From Jane Smith (jane@example.com)",
        link: "/core/partners?application=app-1",
      }),
    );
  });

  it("still logs the audit event and confirms to the partner", async () => {
    await callAction({ pitch: "A pitch" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "partner.application.submitted", targetId: "app-1" }),
    );
    expect(notifyFormSubmission).toHaveBeenCalledWith({ formId: "form-1", submitterUserId: "user-1" });
    expect(sendApplicationReceivedEmail).toHaveBeenCalledWith("jane@example.com", "Jane Smith", "app-1");
  });

  it("rejects with a validation error and does not notify Core", async () => {
    (validateAnswers as any).mockResolvedValue({ error: "Pitch is required.", status: 400 });
    const result = await callAction({});
    expect(result).toEqual({ error: "Pitch is required." });
    expect(notifyPartners).not.toHaveBeenCalled();
  });
});
