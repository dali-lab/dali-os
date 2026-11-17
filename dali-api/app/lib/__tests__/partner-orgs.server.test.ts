import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import { partnerOrgIdsForUser } from "~/lib/partner-orgs.server";

const mockPrisma = prisma as unknown as { partnerContact: Record<string, ReturnType<typeof vi.fn>> };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("partnerOrgIdsForUser", () => {
  it("lists the orgs of memberships that have not ended", async () => {
    mockPrisma.partnerContact.findUnique.mockResolvedValue({ memberships: [{ orgId: "o1" }, { orgId: "o2" }] });
    expect(await partnerOrgIdsForUser("u1")).toEqual(["o1", "o2"]);
    expect(mockPrisma.partnerContact.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" } }),
    );
  });

  it("is empty for an account with no partner contact", async () => {
    mockPrisma.partnerContact.findUnique.mockResolvedValue(null);
    expect(await partnerOrgIdsForUser("u1")).toEqual([]);
  });
});
