import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { applicantFillRedirect } from "~/forms/lib/form-usages.server";

const mockPrisma = prisma as unknown as {
  applicationCycle: { findFirst: ReturnType<typeof vi.fn> };
  partnerApplicationFormBinding: { findFirst: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.applicationCycle.findFirst.mockResolvedValue(null);
  mockPrisma.partnerApplicationFormBinding.findFirst.mockResolvedValue(null);
});

describe("applicantFillRedirect", () => {
  it("sends a Students cycle's application form to the applicant portal", async () => {
    mockPrisma.applicationCycle.findFirst.mockResolvedValue({
      id: "cy1",
      applicants: "Students",
    });
    expect(await applicantFillRedirect("f1")).toBe("/portal/apply/cy1");
  });

  it("sends an Interns cycle to the fellowship portal", async () => {
    mockPrisma.applicationCycle.findFirst.mockResolvedValue({
      id: "cy2",
      applicants: "Interns",
    });
    expect(await applicantFillRedirect("f1")).toBe("/fellowship/cy2");
  });

  it("sends a LabMembers cycle to the internal apply page", async () => {
    mockPrisma.applicationCycle.findFirst.mockResolvedValue({
      id: "cy3",
      applicants: "LabMembers",
    });
    expect(await applicantFillRedirect("f1")).toBe("/core/apply/cy3");
  });

  it("prefers the newest cycle when a form is reused across cycles", async () => {
    mockPrisma.applicationCycle.findFirst.mockResolvedValue({
      id: "cy-new",
      applicants: "Students",
    });
    await applicantFillRedirect("f1");
    expect(mockPrisma.applicationCycle.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } }),
    );
  });

  it("sends a bound partner application form to /partner/apply", async () => {
    mockPrisma.partnerApplicationFormBinding.findFirst.mockResolvedValue({
      id: "b1",
    });
    expect(await applicantFillRedirect("f1")).toBe("/partner/apply");
  });

  // Staffing, education and onboarding forms ARE filled at /forms/fill/:token,
  // so they must keep serving there rather than being redirected away.
  it("returns null for a form no applicant surface owns", async () => {
    expect(await applicantFillRedirect("f1")).toBeNull();
  });
});
