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

const mockPrisma = prisma as unknown as {
  user: {
    upsert: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  dALIMember: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const mockLink = linkCasToGoogleUser as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user = {
    upsert: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  } as any;
  mockPrisma.dALIMember = {
    findFirst: vi.fn(),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  } as any;
});

describe("upsertUserFromGoogle", () => {
  it("@dali.dartmouth.edu → upserts by daliEmail and returns member authType", async () => {
    const userRow = { id: "u-1", netId: null };
    mockPrisma.user.upsert.mockResolvedValue(userRow);
    mockPrisma.dALIMember.findFirst.mockResolvedValue({ id: "m-1", userId: "u-1" });

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
  });

  it("@dali.dartmouth.edu with no existing DALIMember row → creates one", async () => {
    mockPrisma.user.upsert.mockResolvedValue({ id: "u-1", netId: null });
    mockPrisma.dALIMember.findFirst.mockResolvedValue(null);

    await upsertUserFromGoogle({
      email: "new@dali.dartmouth.edu",
      firstName: "New",
      lastName: "Member",
    });

    expect(mockPrisma.dALIMember.create).toHaveBeenCalledWith({
      data: { userId: "u-1", daliEmail: "new@dali.dartmouth.edu" },
    });
  });

  it("@dali.dartmouth.edu with orphan DALIMember (no userId) → links userId", async () => {
    mockPrisma.user.upsert.mockResolvedValue({ id: "u-2", netId: null });
    mockPrisma.dALIMember.findFirst.mockResolvedValue({ id: "m-2", userId: null });

    await upsertUserFromGoogle({
      email: "orphan@dali.dartmouth.edu",
      firstName: "O",
      lastName: "P",
    });

    expect(mockPrisma.dALIMember.update).toHaveBeenCalledWith({
      where: { id: "m-2" },
      data: { userId: "u-2" },
    });
    expect(mockPrisma.dALIMember.create).not.toHaveBeenCalled();
  });

  it("@dali.dartmouth.edu with already-linked DALIMember → no-op on member side", async () => {
    mockPrisma.user.upsert.mockResolvedValue({ id: "u-3", netId: null });
    mockPrisma.dALIMember.findFirst.mockResolvedValue({ id: "m-3", userId: "u-3" });

    await upsertUserFromGoogle({
      email: "linked@dali.dartmouth.edu",
      firstName: "L",
      lastName: "K",
    });

    expect(mockPrisma.dALIMember.update).not.toHaveBeenCalled();
    expect(mockPrisma.dALIMember.create).not.toHaveBeenCalled();
  });

  it("@dartmouth.edu non-DALI → upserts by dartmouthEmail and returns dartmouth authType", async () => {
    const userRow = { id: "u-d", netId: null };
    mockPrisma.user.upsert.mockResolvedValue(userRow);

    const result = await upsertUserFromGoogle({
      email: "stu@dartmouth.edu",
      firstName: "Stu",
      lastName: "Dent",
    });

    expect(result.authType).toBe("dartmouth");
    expect(mockPrisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dartmouthEmail: "stu@dartmouth.edu" } }),
    );
    expect(mockPrisma.dALIMember.findFirst).not.toHaveBeenCalled();
  });

  it("partner email (existing) → findFirst + update, returns partner authType", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u-p", netId: null });
    mockPrisma.user.update.mockResolvedValue({ id: "u-p", netId: null });

    const result = await upsertUserFromGoogle({
      email: "partner@example.com",
      firstName: "Pa",
      lastName: "Rt",
    });

    expect(result.authType).toBe("partner");
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { dartmouthEmail: "partner@example.com" },
    });
    expect(mockPrisma.user.update).toHaveBeenCalled();
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("partner email (new) → findFirst + create, returns partner authType", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: "u-newp", netId: null });

    const result = await upsertUserFromGoogle({
      email: "newpartner@example.com",
      firstName: "Ne",
      lastName: "Wp",
    });

    expect(result.authType).toBe("partner");
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        dartmouthEmail: "newpartner@example.com",
        firstName: "Ne",
        lastName: "Wp",
      },
    });
  });

  it("never writes googleAccessToken / googleRefreshToken / googleTokenExpiresAt", async () => {
    mockPrisma.user.upsert.mockResolvedValue({ id: "u-1", netId: null });
    mockPrisma.dALIMember.findFirst.mockResolvedValue({ id: "m-1", userId: "u-1" });

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
