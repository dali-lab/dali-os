import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
}));

import { resolveWalletPassFields } from "~/lib/wallet-pass-fields.server";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";

const mockFindUnique = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockIsCore = isCore as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveWalletPassFields", () => {
  it("maps a fully-populated member to the card fields", async () => {
    mockFindUnique.mockResolvedValue({
      firstName: "Rachael",
      lastName: "Huang",
      classYear: 2027,
      daliMember: { onboardedAt: new Date("2024-03-10T00:00:00Z") },
      domainEligibilities: [{ domain: { code: "Des" } }],
    });
    mockIsCore.mockResolvedValue(true);

    expect(await resolveWalletPassFields("u1")).toEqual({
      name: "Rachael Huang",
      domainCode: "Des",
      classYearShort: "'27",
      memberSinceTerm: "24S",
      isCore: true,
    });
  });

  it("omits unknown fields and hides the Core badge for non-core members", async () => {
    mockFindUnique.mockResolvedValue({
      firstName: "Sam",
      lastName: "",
      classYear: null,
      daliMember: null,
      domainEligibilities: [],
    });
    mockIsCore.mockResolvedValue(false);

    expect(await resolveWalletPassFields("u2")).toEqual({
      name: "Sam",
      domainCode: null,
      classYearShort: null,
      memberSinceTerm: null,
      isCore: false,
    });
  });

  it("throws when the user is not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(resolveWalletPassFields("missing")).rejects.toThrow(/User not found/);
  });
});
