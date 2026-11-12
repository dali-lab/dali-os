import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import { formUsages, managingUsage } from "~/forms/lib/form-usages.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

beforeEach(() => {
  vi.resetAllMocks();
  for (const delegate of [
    "staffingCycleFormBinding",
    "partnerApplicationFormBinding",
    "partnerSurveyFormBinding",
    "onboardingProfileFormBinding",
    "applicationCycle",
    "cycleDomainForm",
    "educationOffering",
    "educationFormBinding",
  ]) {
    mockPrisma[delegate].findMany?.mockResolvedValue([]);
    mockPrisma[delegate].findFirst?.mockResolvedValue(null);
  }
  mockPrisma.notification.count.mockResolvedValue(0);
});

describe("onboarding profile usage", () => {
  it("comes from the binding and reads as managed", async () => {
    mockPrisma.onboardingProfileFormBinding.findFirst.mockResolvedValue({ id: "b1" });
    const usages = await formUsages("form-1");
    expect(mockPrisma.onboardingProfileFormBinding.findFirst).toHaveBeenCalledWith({
      where: { formId: "form-1" },
      select: { id: true },
    });
    expect(managingUsage(usages)).toMatchObject({
      kind: "onboarding-profile",
      href: "/hiring/onboarding",
    });
  });

  it("ignores the form's name", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ name: "Welcome to DALI! 👋" });
    expect(await formUsages("form-1")).toEqual([]);
  });
});
