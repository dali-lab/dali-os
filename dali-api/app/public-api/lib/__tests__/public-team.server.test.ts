import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { user: { findMany: vi.fn() } } }));

import { prisma } from "~/lib/db";
import { listPublicTeam } from "~/public-api/lib/public-team.server";

const mockPrisma = prisma as unknown as {
  user: { findMany: ReturnType<typeof vi.fn> };
};

const term = (code: string, sortKey: number) => ({ code, sortKey });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPublicTeam query shape", () => {
  it("only ever reads members who opted in", async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    await listPublicTeam();
    expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.findMany.mock.calls[0][0].where).toEqual({
      publicProfile: true,
    });
  });

  // The point of this test is the *absence* of columns. The User model holds
  // phone numbers, birthdays, ethnicity, dietary restrictions, NetIDs, and
  // three email addresses; a careless `select` widening here would publish
  // them to the open internet. Prisma's select is the real control, so assert
  // on it directly rather than only on the mapped output.
  it("selects no sensitive column", async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    await listPublicTeam();
    const select = mockPrisma.user.findMany.mock.calls[0][0].select;

    for (const forbidden of [
      "phoneNumber",
      "birthday",
      "ethnicity",
      "dietaryRestrictions",
      "nameOnFile",
      "netId",
      "daliEmail",
      "dartmouthEmail",
      "personalEmail",
      "slackUserId",
      "hometown",
      "handle",
    ]) {
      expect(select, `must not select ${forbidden}`).not.toHaveProperty(forbidden);
    }

    expect(Object.keys(select).sort()).toEqual([
      "classYear",
      "coreAssignments",
      "firstName",
      "id",
      "lastName",
      "linkedinUrl",
      "major",
      "photoUrl",
      "projectAssignments",
    ]);
  });
});

describe("listPublicTeam mapping", () => {
  it("derives roles, terms, and the headline role from assignments", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: "u1",
        firstName: "Ada",
        lastName: "Lovelace",
        classYear: 2027,
        major: "Computer Science",
        photoUrl: "uploads/avatars/u1.webp",
        linkedinUrl: "https://linkedin.com/in/ada",
        projectAssignments: [
          { domain: { displayName: "Fullstack Dev" }, term: term("25F", 20254) },
          // Same domain in an earlier term must not duplicate the role.
          { domain: { displayName: "Fullstack Dev" }, term: term("25S", 20252) },
          { domain: { displayName: "UI/UX" }, term: term("24F", 20244) },
        ],
        coreAssignments: [],
      },
    ]);

    const [m] = await listPublicTeam();
    expect(m.name).toBe("Ada Lovelace");
    expect(m.year).toBe("2027");
    expect(m.majorMinor).toBe("Computer Science");
    // Most recent term first.
    expect(m.roles).toEqual(["Fullstack Dev", "UI/UX"]);
    expect(m.role).toBe("Fullstack Dev");
    expect(m.currentRole).toBe("Fullstack Dev");
    // Chronological, deduped.
    expect(m.termsInDali).toEqual(["24F", "25S", "25F"]);
    expect(m.profileImage).toBe("/api/media?key=uploads%2Favatars%2Fu1.webp");
  });

  it("lets a Core title outrank a domain as the headline role", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: "u2",
        firstName: "Grace",
        lastName: "Hopper",
        classYear: null,
        major: null,
        photoUrl: null,
        linkedinUrl: null,
        projectAssignments: [
          { domain: { displayName: "Data Science" }, term: term("26W", 20261) },
        ],
        coreAssignments: [{ leadTitle: "Education Lead", term: term("26W", 20261) }],
      },
    ]);

    const [m] = await listPublicTeam();
    expect(m.coreRoleNames).toEqual(["Education Lead"]);
    expect(m.currentRole).toBe("Education Lead");
    // The domain is still listed — it just isn't the headline.
    expect(m.roles).toEqual(["Data Science"]);
  });

  it("renders a member with no assignments or profile fields without blowing up", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: "u3",
        firstName: "New",
        lastName: "Member",
        classYear: null,
        major: null,
        photoUrl: null,
        linkedinUrl: null,
        projectAssignments: [],
        coreAssignments: [],
      },
    ]);

    const [m] = await listPublicTeam();
    expect(m).toMatchObject({
      role: "",
      roles: [],
      year: "",
      majorMinor: "",
      currentRole: "",
      termsInDali: [],
      profileImage: "",
      linkedinUrl: "",
    });
  });

  it("ignores Core rows with no title", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: "u4",
        firstName: "A",
        lastName: "B",
        classYear: null,
        major: null,
        photoUrl: null,
        linkedinUrl: null,
        projectAssignments: [],
        coreAssignments: [{ leadTitle: null, term: term("26W", 20261) }],
      },
    ]);

    const [m] = await listPublicTeam();
    expect(m.coreRoleNames).toEqual([]);
    // The term still counts toward time in the lab.
    expect(m.termsInDali).toEqual(["26W"]);
  });
});
