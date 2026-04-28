import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { linkCasToGoogleUser } from "~/lib/linking";

const mockPrisma = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  refreshToken: { updateMany: ReturnType<typeof vi.fn> };
  oAuthSession: { updateMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-at-least-32-chars-long!!";
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("linkCasToGoogleUser", () => {
  const googleUser = {
    id: "g1",
    daliEmail: "g@dali.dartmouth.edu",
    dartmouthEmail: null,
    netId: null,
    firstName: "Goo",
    lastName: "Gle",
  };

  const casUser = {
    id: "c1",
    daliEmail: null,
    dartmouthEmail: "c@dartmouth.edu",
    netId: "d12345a",
    firstName: "Cas",
    lastName: "User",
  };

  it("merges separate users via transaction", async () => {
    // first call: findUnique by id (googleUser), second: findUnique by netId (casUser)
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(googleUser)
      .mockResolvedValueOnce(casUser);

    const mergedUser = { ...casUser, daliEmail: googleUser.daliEmail };
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      // provide a mock tx with the same methods
      const tx = {
        dALIMember: { updateMany: vi.fn().mockResolvedValue({}) },
        refreshToken: { updateMany: vi.fn().mockResolvedValue({}) },
        oAuthSession: { updateMany: vi.fn().mockResolvedValue({}) },
        user: {
          delete: vi.fn().mockResolvedValue({}),
          update: vi.fn().mockResolvedValue(mergedUser),
        },
      };
      return fn(tx);
    });

    const result = await linkCasToGoogleUser("g1", "d12345a");
    expect(result).toEqual(mergedUser);
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it("returns same user when CAS user is the same record (no-op)", async () => {
    const sameUser = { ...googleUser, id: "same1", netId: "d12345a" };
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(sameUser) // google lookup
      .mockResolvedValueOnce(sameUser); // cas lookup (same id)

    const result = await linkCasToGoogleUser("same1", "d12345a");
    expect(result).toEqual(sameUser);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("attaches netId to Google user when no CAS user exists", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(googleUser) // google lookup
      .mockResolvedValueOnce(null); // no CAS user

    const updated = { ...googleUser, netId: "d12345a" };
    mockPrisma.user.update.mockResolvedValue(updated);

    const result = await linkCasToGoogleUser("g1", "d12345a");
    expect(result).toEqual(updated);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { netId: "d12345a" },
    });
  });

  it("throws when Google user not found", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(linkCasToGoogleUser("missing", "d12345a")).rejects.toThrow(
      "Google user not found",
    );
  });
});
