import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { formUsages, managingUsage, staffingUsage } from "~/forms/lib/form-usages.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

beforeEach(() => {
  vi.resetAllMocks();
  // Every other usage source empty; only the staffing binding matters here.
  for (const delegate of [
    "partnerApplicationFormBinding",
    "applicationCycle",
    "cycleDomainForm",
    "educationOffering",
    "educationFormBinding",
  ]) {
    mockPrisma[delegate].findMany?.mockResolvedValue([]);
    mockPrisma[delegate].findFirst?.mockResolvedValue(null);
  }
  mockPrisma.notification.count.mockResolvedValue(0);
  mockPrisma.form.findUnique.mockResolvedValue({ name: "Intent to Work Form" });
});

describe("staffing usage", () => {
  it("carries the term code {{term}} resolves to, and reads as managed", async () => {
    mockPrisma.staffingCycleFormBinding.findMany.mockResolvedValue([
      {
        slot: "intent-to-work",
        staffingCycle: { term: { code: "27W" } },
      },
    ]);

    const usages = await formUsages("form-1");
    const staffing = staffingUsage(usages);

    expect(staffing).toMatchObject({
      kind: "staffing",
      label: "27W Intent to Work",
      termCode: "27W",
    });
    // Managed means the generic distribution settings stay hidden and the
    // server refuses changes to them, one-response included.
    expect(managingUsage(usages)?.kind).toBe("staffing");
  });

  it("reports no staffing usage for an unbound form", async () => {
    mockPrisma.staffingCycleFormBinding.findMany.mockResolvedValue([]);

    const usages = await formUsages("form-1");

    expect(staffingUsage(usages)).toBeNull();
  });
});
