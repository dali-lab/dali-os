import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/partners/lib/partner-auth.server", () => ({
  requirePartnerAccount: vi.fn(),
  requirePartnerOrgAccess: vi.fn(),
}));
vi.mock("~/partners/lib/application-form.server", () => ({ loadApplicationForm: vi.fn() }));
vi.mock("~/partners/lib/partner-survey.server", () => ({ loadSurveyForm: vi.fn() }));
vi.mock("~/forms/lib/submission-notify.server", () => ({ notifyFormSubmission: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/partners/lib/partner-activity.server", () => ({ logPartnerActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/partners/lib/partner-notify.server", () => ({ notifyPartners: vi.fn().mockResolvedValue({}) }));
vi.mock("~/partners/lib/partner-emails.server", () => ({ sendApplicationReceivedEmail: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db.server";
import { requirePartnerAccount, requirePartnerOrgAccess } from "~/partners/lib/partner-auth.server";
import { loadApplicationForm } from "~/partners/lib/application-form.server";
import { loadSurveyForm } from "~/partners/lib/partner-survey.server";
import { action as applyAction } from "~/partners/routes/partner.apply";
import { action as surveyAction } from "~/partners/routes/partner.survey.$projectPartnerId";

const db = prisma as unknown as Record<string, any>;

const QUESTIONS = [
  { key: "kind", type: "select", required: true, data: { label: "Kind", options: ["Research", "Product"] } },
  {
    key: "grant",
    type: "text",
    required: true,
    data: { label: "Grant number", showIf: { questionKey: "kind", op: "is", value: "Research" } },
  },
];
const FORM = {
  formId: "form-1",
  name: "Form",
  versionId: "ver-1",
  versionUpdatedAt: "2026-01-01T00:00:00.000Z",
  description: null,
  questions: QUESTIONS,
};

function post(answers: Record<string, unknown>) {
  const body = new FormData();
  body.set("formAnswers", JSON.stringify(answers));
  body.set("formVersionUpdatedAt", FORM.versionUpdatedAt);
  return new Request("http://localhost/x", { method: "POST", body });
}
const storedAnswers = () => db.formSubmission.create.mock.calls[0][0].data.answers;

beforeEach(() => {
  vi.clearAllMocks();
  (requirePartnerAccount as any).mockResolvedValue({
    auth: { user: { sub: "user-1" } },
    contact: { id: "contact-1", name: "Jane Smith", email: "jane@example.com" },
  });
  (requirePartnerOrgAccess as any).mockResolvedValue({
    auth: { user: { sub: "user-1" } },
    contact: { id: "contact-1" },
  });
  (loadApplicationForm as any).mockResolvedValue(FORM);
  (loadSurveyForm as any).mockResolvedValue(FORM);
  db.formSubmission.create.mockResolvedValue({ id: "sub-1" });
  db.partnerApplication.create.mockResolvedValue({ id: "app-1" });
  db.projectPartner = { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) };
  db.projectPartner.findUnique.mockResolvedValue({
    id: "pp-1",
    surveySubmissionId: null,
    partnerOrgId: "org-1",
    project: { name: "Kiosk" },
  });
  db.$transaction.mockImplementation((fn: (tx: any) => Promise<any>) => fn(db));
});

describe("partner.apply with rules", () => {
  const run = (answers: Record<string, unknown>) =>
    applyAction({ request: post(answers), params: {}, context: {} } as any);

  it("accepts a submission that skips a hidden required question and stores no hidden answer", async () => {
    const res = (await run({ kind: "Product", grant: "stale" })) as Response;
    expect(res.status).toBe(302);
    expect(storedAnswers()).toEqual({ kind: "Product" });
  });

  it("requires the question when its rule shows it", async () => {
    expect(await run({ kind: "Research" })).toEqual({ error: '"Grant number" is required.' });
    expect(db.formSubmission.create).not.toHaveBeenCalled();
  });
});

describe("partner.survey with rules", () => {
  const run = (answers: Record<string, unknown>) =>
    surveyAction({ request: post(answers), params: { projectPartnerId: "pp-1" }, context: {} } as any);

  it("accepts a submission that skips a hidden required question and stores no hidden answer", async () => {
    await run({ kind: "Product", grant: "stale" });
    expect(storedAnswers()).toEqual({ kind: "Product" });
  });

  it("requires the question when its rule shows it", async () => {
    expect(await run({ kind: "Research" })).toEqual({ error: '"Grant number" is required.' });
    expect(db.formSubmission.create).not.toHaveBeenCalled();
  });
});
