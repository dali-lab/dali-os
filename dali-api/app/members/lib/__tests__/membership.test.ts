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

const EXISTING = {
  id: "existing",
  daliEmail: null,
  dartmouthEmail: null,
  personalEmail: "ada@example.com",
  netId: null,
  daliMember: null,
};

// First findFirst is the identity lookup (an OR query); later ones are
// single-column collision checks keyed by the column being claimed.
function mockLookup(found: object | null, takenColumns: string[] = []) {
  mockPrisma.user.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
    if ("OR" in args.where) return found;
    return takenColumns.some((c) => c in args.where) ? { id: "other" } : null;
  });
}

describe("createOrPromoteMember dartmouth alias collisions", () => {
  it("rejects a new member whose alias is on another account", async () => {
    mockLookup(null, ["dartmouthEmail"]);
    await expect(
      createOrPromoteMember({ ...OK, dartmouthEmail: "ada@dartmouth.edu" }, "actor"),
    ).rejects.toThrow("That Dartmouth email is already on another account.");
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("rejects attaching an alias held by a different account to an existing user", async () => {
    mockLookup(EXISTING, ["dartmouthEmail"]);
    await expect(
      createOrPromoteMember({ ...OK, dartmouthEmail: "ada@dartmouth.edu" }, "actor"),
    ).rejects.toBeInstanceOf(MemberInputError);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("attaches the alias to an existing user when it is free", async () => {
    mockLookup(EXISTING);
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
    mockLookup({ ...EXISTING, dartmouthEmail: "x@dartmouth.edu", daliMember: { id: "m1" } });
    await createOrPromoteMember({ ...OK, dartmouthEmail: "ada@dartmouth.edu" }, "actor");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe("createOrPromoteMember identity backfill", () => {
  const lookupWhere = () => mockPrisma.user.findFirst.mock.calls[0][0].where.OR;

  it("accepts daliEmail without email", async () => {
    await createOrPromoteMember(
      { firstName: "Ada", lastName: "Lovelace", daliEmail: "Ada@DALI.Dartmouth.edu" },
      "actor",
    );
    expect(mockPrisma.user.create.mock.calls[0][0].data).toMatchObject({
      daliEmail: "ada@dali.dartmouth.edu",
    });
  });

  it("throws when no email of any kind is given, even with a netId", async () => {
    await expect(
      createOrPromoteMember({ firstName: "Ada", lastName: "Lovelace", netId: "f001" }, "actor"),
    ).rejects.toThrow("An email is required.");
  });

  it.each([
    [{ daliEmail: "ada@gmail.com" }, "The DALI email must be an @dali.dartmouth.edu address."],
    [{ dartmouthEmail: "ada@dali.dartmouth.edu" }, "The Dartmouth email must be an @dartmouth.edu address."],
    [{ birthday: "2001-13-01" }, "Birthday must be YYYY-MM-DD."],
    [{ birthday: "2001-02-30" }, "Birthday must be YYYY-MM-DD."],
    [{ birthday: "01/02/2001" }, "Birthday must be YYYY-MM-DD."],
  ])("rejects %j", async (extra, message) => {
    await expect(createOrPromoteMember({ ...OK, ...extra }, "actor")).rejects.toThrow(message);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("lets an explicit field win over the suffix-routed email", async () => {
    await createOrPromoteMember(
      { ...OK, email: "ada@dartmouth.edu", dartmouthEmail: "other@dartmouth.edu" },
      "actor",
    );
    expect(mockPrisma.user.create.mock.calls[0][0].data.dartmouthEmail).toBe("other@dartmouth.edu");
  });

  it("matches each email against all three email columns and netId only against netId", async () => {
    await createOrPromoteMember({ ...OK, netId: "F001ABC" }, "actor");
    expect(lookupWhere()).toEqual([
      { daliEmail: "ada@example.com" },
      { dartmouthEmail: "ada@example.com" },
      { personalEmail: "ada@example.com" },
      { netId: "f001abc" },
    ]);
  });

  it("finds an existing user by personalEmail given as the only email", async () => {
    mockLookup({ ...EXISTING, personalEmail: "p@example.com" });
    const out = await createOrPromoteMember(
      { firstName: "Ada", lastName: "Lovelace", personalEmail: "p@example.com" },
      "actor",
    );
    expect(out).toEqual({ id: "existing", created: false });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(lookupWhere()).toContainEqual({ personalEmail: "p@example.com" });
  });

  it("finds an existing user by netId alone matched on the netId column", async () => {
    mockLookup(EXISTING);
    const out = await createOrPromoteMember({ ...OK, netId: "f001abc" }, "actor");
    expect(out).toEqual({ id: "existing", created: false });
    expect(lookupWhere()).toContainEqual({ netId: "f001abc" });
  });

  it("writes only the null columns on an existing user", async () => {
    mockLookup({
      ...EXISTING,
      daliEmail: "keep@dali.dartmouth.edu",
      githubUsername: "keep",
      classYear: 2026,
    });
    await createOrPromoteMember(
      {
        ...OK,
        daliEmail: "new@dali.dartmouth.edu",
        netId: "F001ABC",
        githubUsername: "changed",
        classYear: 2030,
        phoneNumber: "555",
        birthday: "2001-02-03",
        dietaryRestrictions: "none",
        major: "Math",
      },
      "actor",
    );
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "existing" },
      data: {
        netId: "f001abc",
        major: "Math",
        phoneNumber: "555",
        dietaryRestrictions: "none",
        birthday: new Date("2001-02-03T00:00:00.000Z"),
      },
    });
  });

  it("does not update when every column is already set", async () => {
    mockLookup({
      ...EXISTING,
      netId: "x",
      classYear: 2026,
      phoneNumber: "1",
    });
    await createOrPromoteMember({ ...OK, netId: "y", classYear: 2030, phoneNumber: "2" }, "actor");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("does not copy a value into a second column when the user already holds it", async () => {
    mockLookup({ ...EXISTING, personalEmail: null, dartmouthEmail: "ada@example.com" });
    await createOrPromoteMember(OK, "actor");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it.each([
    [{ daliEmail: "ada@dali.dartmouth.edu" }, "daliEmail", "That DALI email is already on another account."],
    [{ netId: "f001" }, "netId", "That NetID is already on another account."],
    [{ personalEmail: "p@example.com", email: "ada@dartmouth.edu" }, "personalEmail", "That personal email is already on another account."],
  ])("rejects %j claimed by another account", async (extra, column, message) => {
    mockLookup({ ...EXISTING, personalEmail: null }, [column]);
    await expect(
      createOrPromoteMember({ ...OK, ...extra }, "actor"),
    ).rejects.toThrow(message);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects a new member whose netId is on another account", async () => {
    mockLookup(null, ["netId"]);
    await expect(createOrPromoteMember({ ...OK, netId: "f001" }, "actor")).rejects.toThrow(
      "That NetID is already on another account.",
    );
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("creates a new member with every identity and profile column", async () => {
    await createOrPromoteMember(
      {
        ...OK,
        daliEmail: "ada@dali.dartmouth.edu",
        netId: "F001",
        githubUsername: "ada",
        phoneNumber: "555",
        birthday: "2001-02-03",
        dietaryRestrictions: "vegan",
      },
      "actor",
    );
    expect(mockPrisma.user.create.mock.calls[0][0].data).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      personalEmail: "ada@example.com",
      daliEmail: "ada@dali.dartmouth.edu",
      netId: "f001",
      githubUsername: "ada",
      phoneNumber: "555",
      birthday: new Date("2001-02-03T00:00:00.000Z"),
      dietaryRestrictions: "vegan",
      classYear: undefined,
      daliMember: { create: {} },
    });
  });
});
