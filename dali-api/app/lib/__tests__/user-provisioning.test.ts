import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/linking", () => ({
  linkCasToGoogleUser: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { linkCasToGoogleUser } from "~/lib/linking";
import {
  upsertUserFromGoogle,
  upsertUserFromCas,
} from "~/lib/user-provisioning";

// Phase 2: upsertUserFromGoogle is member-only (@dali.dartmouth.edu).
// Non-DALI branches throw — partners auth via magic-link instead.

const mockPrisma = prisma as unknown as {
  user: {
    upsert: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  dALIMember: {
    upsert: ReturnType<typeof vi.fn>;
  };
};

const mockLink = linkCasToGoogleUser as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user = {
    upsert: vi.fn(),
    findFirst: vi.fn(),
    // assignHandleIfMissing reads this after provisioning; undefined → the
    // helper early-returns (no handle to seed in these unit tests).
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  } as any;
  mockPrisma.dALIMember = {
    upsert: vi.fn().mockResolvedValue({}),
  } as any;
});

describe("upsertUserFromGoogle", () => {
  it("@dali.dartmouth.edu → upserts user by daliEmail and the DALIMember marker", async () => {
    const userRow = { id: "u-1", netId: null };
    mockPrisma.user.upsert.mockResolvedValue(userRow);

    const result = await upsertUserFromGoogle({
      email: "k@dali.dartmouth.edu",
      firstName: "K",
      lastName: "J",
    });

    expect(result.authType).toBe("member");
    expect(result.user).toBe(userRow);
    expect(mockPrisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { daliEmail: "k@dali.dartmouth.edu" } }),
    );
    expect(mockPrisma.dALIMember.upsert).toHaveBeenCalledWith({
      where: { userId: "u-1" },
      update: {},
      create: { userId: "u-1" },
    });
  });

  it("@dartmouth.edu (non-DALI) → throws (Phase 2 dropped the dartmouth branch)", async () => {
    await expect(
      upsertUserFromGoogle({
        email: "stu@dartmouth.edu",
        firstName: "Stu",
        lastName: "Dent",
      }),
    ).rejects.toThrow(/@dali\.dartmouth\.edu/);
    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
  });

  it("external partner email → throws (Phase 2 dropped the partner branch)", async () => {
    await expect(
      upsertUserFromGoogle({
        email: "partner@example.com",
        firstName: "Pa",
        lastName: "Rt",
      }),
    ).rejects.toThrow(/@dali\.dartmouth\.edu/);
    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
  });

  it("never writes googleAccessToken / googleRefreshToken / googleTokenExpiresAt", async () => {
    mockPrisma.user.upsert.mockResolvedValue({ id: "u-1", netId: null });

    await upsertUserFromGoogle({
      email: "k@dali.dartmouth.edu",
      firstName: "K",
      lastName: "J",
    });

    const args = mockPrisma.user.upsert.mock.calls[0][0];
    expect(args.create).not.toHaveProperty("googleAccessToken");
    expect(args.create).not.toHaveProperty("googleRefreshToken");
    expect(args.create).not.toHaveProperty("googleTokenExpiresAt");
    expect(args.update).not.toHaveProperty("googleAccessToken");
    expect(args.update).not.toHaveProperty("googleRefreshToken");
    expect(args.update).not.toHaveProperty("googleTokenExpiresAt");
  });
});

describe("upsertUserFromCas", () => {
  it("standalone CAS login → upserts by netId, sets dartmouthEmail from netId", async () => {
    const userRow = { id: "u-cas", netId: "abc123" };
    mockPrisma.user.upsert.mockResolvedValue(userRow);

    const result = await upsertUserFromCas({
      netId: "abc123",
      firstName: "Test",
      lastName: "User",
    });

    expect(result.user).toBe(userRow);
    expect(mockPrisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { netId: "abc123" },
        create: expect.objectContaining({
          netId: "abc123",
          dartmouthEmail: "abc123@dartmouth.edu",
        }),
        update: expect.objectContaining({
          dartmouthEmail: "abc123@dartmouth.edu",
        }),
      }),
    );
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("with linkUserId → calls linkCasToGoogleUser, skips standalone upsert", async () => {
    const merged = { id: "u-merged", netId: "xyz789" };
    mockLink.mockResolvedValue(merged);

    const result = await upsertUserFromCas(
      { netId: "xyz789", firstName: "M", lastName: "Erge" },
      { linkUserId: "u-google" },
    );

    expect(result.user).toBe(merged);
    expect(mockLink).toHaveBeenCalledWith("u-google", "xyz789");
    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
  });

  it("omits firstName/lastName from update if empty", async () => {
    const userRow = { id: "u-cas", netId: "n1" };
    mockPrisma.user.upsert.mockResolvedValue(userRow);

    await upsertUserFromCas({ netId: "n1", firstName: "", lastName: "" });

    const args = mockPrisma.user.upsert.mock.calls[0][0];
    expect(args.update).not.toHaveProperty("firstName");
    expect(args.update).not.toHaveProperty("lastName");
    expect(args.update).toHaveProperty("dartmouthEmail");
  });
});
