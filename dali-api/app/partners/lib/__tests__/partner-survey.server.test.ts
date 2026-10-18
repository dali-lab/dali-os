import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/app-env", () => ({ getFrontendUrl: vi.fn(() => "https://os.dali.dartmouth.edu") }));
vi.mock("~/partners/lib/partner-emails.server", () => ({ sendPartnerSurveyEmail: vi.fn() }));
vi.mock("~/forms/lib/public-form", () => ({ loadPublicForm: vi.fn() }));

import { prisma } from "~/lib/db";
import { loadPublicForm } from "~/forms/lib/public-form";
import { sendPartnerSurveyEmail } from "~/partners/lib/partner-emails.server";
import {
  getSurveyFormBinding,
  setSurveyFormBinding,
  clearSurveyFormBinding,
  loadSurveyForm,
  sendPartnerSurvey,
} from "../partner-survey.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const mockLoadPublicForm = loadPublicForm as unknown as ReturnType<typeof vi.fn>;
const mockSendEmail = sendPartnerSurveyEmail as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSurveyFormBinding", () => {
  it("returns null when nothing is bound", async () => {
    mockPrisma.partnerSurveyFormBinding = { findFirst: vi.fn().mockResolvedValue(null) };
    expect(await getSurveyFormBinding()).toBeNull();
  });

  it("shapes the bound form", async () => {
    mockPrisma.partnerSurveyFormBinding = {
      findFirst: vi.fn().mockResolvedValue({
        form: { id: "f1", name: "Survey", published: true, publicToken: "tok", _count: { versions: 2 } },
      }),
    };
    expect(await getSurveyFormBinding()).toEqual({
      formId: "f1",
      formName: "Survey",
      published: true,
      publicToken: "tok",
      hasVersion: true,
    });
  });
});

describe("setSurveyFormBinding", () => {
  it("rejects a formId that doesn't exist", async () => {
    mockPrisma.form = { findUnique: vi.fn().mockResolvedValue(null) };
    const result = await setSurveyFormBinding("missing", "u1");
    expect(result).toEqual({ ok: false, error: "That form no longer exists." });
  });

  it("replaces the singleton binding", async () => {
    mockPrisma.form = { findUnique: vi.fn().mockResolvedValue({ id: "f1" }) };
    mockPrisma.partnerSurveyFormBinding = { deleteMany: vi.fn(), create: vi.fn() };
    const result = await setSurveyFormBinding("f1", "u1");
    expect(result).toEqual({ ok: true });
    expect(mockPrisma.partnerSurveyFormBinding.deleteMany).toHaveBeenCalledWith({});
    expect(mockPrisma.partnerSurveyFormBinding.create).toHaveBeenCalledWith({
      data: { formId: "f1", updatedById: "u1" },
    });
  });
});

describe("clearSurveyFormBinding", () => {
  it("deletes every binding row", async () => {
    mockPrisma.partnerSurveyFormBinding = { deleteMany: vi.fn() };
    await clearSurveyFormBinding();
    expect(mockPrisma.partnerSurveyFormBinding.deleteMany).toHaveBeenCalledWith({});
  });
});

describe("loadSurveyForm", () => {
  it("returns null when no form is bound", async () => {
    mockPrisma.partnerSurveyFormBinding = { findFirst: vi.fn().mockResolvedValue(null) };
    expect(await loadSurveyForm()).toBeNull();
    expect(mockLoadPublicForm).not.toHaveBeenCalled();
  });

  it("loads the bound form by its public token", async () => {
    mockPrisma.partnerSurveyFormBinding = {
      findFirst: vi.fn().mockResolvedValue({
        form: { id: "f1", name: "Survey", published: true, publicToken: "tok", _count: { versions: 1 } },
      }),
    };
    mockLoadPublicForm.mockResolvedValue({ formId: "f1" });
    const result = await loadSurveyForm("user-1");
    expect(mockLoadPublicForm).toHaveBeenCalledWith("tok", "user-1");
    expect(result).toEqual({ formId: "f1" });
  });
});

describe("sendPartnerSurvey", () => {
  it("errors when the partnership doesn't exist", async () => {
    mockPrisma.projectPartner = { findUnique: vi.fn().mockResolvedValue(null) };
    const result = await sendPartnerSurvey({ projectPartnerId: "pp-missing" });
    expect(result).toEqual({ ok: false, error: "Partnership not found" });
  });

  it("errors when the org has no contact", async () => {
    mockPrisma.projectPartner = {
      findUnique: vi.fn().mockResolvedValue({
        id: "pp1",
        partnerOrg: { id: "org1", name: "Acme", primaryContactId: null },
        project: { name: "Alumni Connect" },
      }),
    };
    mockPrisma.partnerMembership = { findFirst: vi.fn().mockResolvedValue(null) };
    const result = await sendPartnerSurvey({ projectPartnerId: "pp1" });
    expect(result).toEqual({ ok: false, error: "This organization has no contact to email." });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("emails the primary contact and stamps surveySentAt", async () => {
    mockPrisma.projectPartner = {
      findUnique: vi.fn().mockResolvedValue({
        id: "pp1",
        partnerOrg: { id: "org1", name: "Acme", primaryContactId: "m1" },
        project: { name: "Alumni Connect" },
      }),
      update: vi.fn(),
    };
    mockPrisma.partnerMembership = { findUnique: vi.fn().mockResolvedValue({ contactId: "c1" }) };
    mockPrisma.partnerContact = {
      findUnique: vi.fn().mockResolvedValue({ id: "c1", name: "Pat", email: "pat@x.com" }),
    };

    const result = await sendPartnerSurvey({ projectPartnerId: "pp1" });

    expect(result).toEqual({ ok: true });
    expect(mockSendEmail).toHaveBeenCalledWith(
      "pat@x.com",
      "Pat",
      "Alumni Connect",
      "https://os.dali.dartmouth.edu/partner/survey/pp1",
      "pp1",
    );
    expect(mockPrisma.projectPartner.update).toHaveBeenCalledWith({
      where: { id: "pp1" },
      data: { surveySentAt: expect.any(Date) },
    });
  });

  it("falls back to the org's earliest membership when there's no primary contact", async () => {
    mockPrisma.projectPartner = {
      findUnique: vi.fn().mockResolvedValue({
        id: "pp1",
        partnerOrg: { id: "org1", name: "Acme", primaryContactId: null },
        project: { name: "Alumni Connect" },
      }),
      update: vi.fn(),
    };
    mockPrisma.partnerMembership = { findFirst: vi.fn().mockResolvedValue({ contactId: "c2" }) };
    mockPrisma.partnerContact = {
      findUnique: vi.fn().mockResolvedValue({ id: "c2", name: "Early", email: "early@x.com" }),
    };

    const result = await sendPartnerSurvey({ projectPartnerId: "pp1" });

    expect(result).toEqual({ ok: true });
    expect(mockSendEmail).toHaveBeenCalledWith(
      "early@x.com",
      "Early",
      "Alumni Connect",
      expect.any(String),
      "pp1",
    );
  });
});
