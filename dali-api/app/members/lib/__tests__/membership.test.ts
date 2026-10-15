import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/handle", () => ({ assignHandleIfMissing: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/admin/lib/eligibility.server", () => ({ addOrUpdateEligibility: vi.fn() }));

import { prisma } from "~/lib/db";
import {
  createOrPromoteMember,
  MemberInputError,
  PROFILE_TEXT_FIELDS,
} from "~/members/lib/membership.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

const OK = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findFirst.mockResolvedValue(null);
  mockPrisma.user.create = vi.fn().mockResolvedValue({ id: "new-1" });
  mockPrisma.user.update.mockResolvedValue({});
  mockPrisma.dALIMember = {
    findUnique: vi.fn().mockResolvedValue({ id: "m1" }),
    create: vi.fn(),
  };
});

describe("createOrPromoteMember validation", () => {
  it.each([
    [{ firstName: "" }, "First and last name are required."],
    [{ lastName: "   " }, "First and last name are required."],
    [{ email: "  " }, "An email is required."],
    [{ dartmouthEmail: "a@gmail.com" }, "The Dartmouth email must be an @dartmouth.edu address."],
    [{ classYear: "abc" }, "Class year must be a 4-digit year."],
    [{ classYear: "1899" }, "Class year must be a 4-digit year."],
    [{ classYear: 2101 }, "Class year must be a 4-digit year."],
  ])("rejects %j", async (override, message) => {
    const err = await createOrPromoteMember({ ...OK, ...override }, "actor").catch((e) => e);
    expect(err).toBeInstanceOf(MemberInputError);
    expect(err.message).toBe(message);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("treats a blank class year string as absent", async () => {
    await createOrPromoteMember({ ...OK, classYear: " " }, "actor");
    expect(mockPrisma.user.create.mock.calls[0][0].data.classYear).toBeUndefined();
  });

  it("parses a numeric class year string", async () => {
    await createOrPromoteMember({ ...OK, classYear: "2027" }, "actor");
    expect(mockPrisma.user.create.mock.calls[0][0].data.classYear).toBe(2027);
  });

  it("drops blank profile fields and trims the rest", async () => {
    await createOrPromoteMember({ ...OK, pronouns: " she/her ", major: "  " }, "actor");
    const data = mockPrisma.user.create.mock.calls[0][0].data;
    expect(data.pronouns).toBe("she/her");
    expect(data).not.toHaveProperty("major");
  });

  it("exposes the profile fields the form offers", () => {
    expect([...PROFILE_TEXT_FIELDS]).toEqual([
      "pronouns",
      "major",
      "hometown",
      "linkedinUrl",
      "personalSite",
    ]);
  });
});

describe("createOrPromoteMember dartmouth alias collisions", () => {
  it("rejects a new member whose alias is on another account", async () => {
    mockPrisma.user.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "other" });
    await expect(
      createOrPromoteMember({ ...OK, dartmouthEmail: "ada@dartmouth.edu" }, "actor"),
    ).rejects.toThrow("That Dartmouth email is already on another account.");
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("rejects attaching an alias held by a different account to an existing user", async () => {
    mockPrisma.user.findFirst
      .mockResolvedValueOnce({ id: "existing", dartmouthEmail: null, daliMember: null })
      .mockResolvedValueOnce({ id: "other" });
    await expect(
      createOrPromoteMember({ ...OK, dartmouthEmail: "ada@dartmouth.edu" }, "actor"),
    ).rejects.toBeInstanceOf(MemberInputError);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("attaches the alias to an existing user when it is free", async () => {
    mockPrisma.user.findFirst
      .mockResolvedValueOnce({ id: "existing", dartmouthEmail: null, daliMember: null })
      .mockResolvedValueOnce(null);
    const out = await createOrPromoteMember(
      { ...OK, dartmouthEmail: "ada@dartmouth.edu" },
      "actor",
    );
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "existing" },
      data: { dartmouthEmail: "ada@dartmouth.edu" },
    });
    expect(out).toEqual({ id: "existing", created: false });
  });

  it("leaves an existing user's alias alone when already set", async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce({
      id: "existing",
      dartmouthEmail: "x@dartmouth.edu",
      daliMember: { id: "m1" },
    });
    await createOrPromoteMember({ ...OK, dartmouthEmail: "ada@dartmouth.edu" }, "actor");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
