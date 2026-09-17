import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
    },
    term: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("~/lib/roles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/roles")>();
  return {
    ...actual,
    isAdminViaEnv: vi.fn().mockReturnValue(false),
    currentTerm: vi.fn().mockResolvedValue({ id: "term-1", code: "26S" }),
    currentTermMemberWhere: vi.fn().mockResolvedValue({
      OR: [
        { coreAssignments: { some: { termId: "term-1" } } },
        { projectAssignments: { some: { termId: "term-1" } } },
      ],
    }),
  };
});

import { prisma } from "~/lib/db";
import { runListMembers, LIST_MEMBERS_DEF } from "~/mcp/tools/personal/list-members";

const mockUser = prisma as unknown as {
  user: { findMany: ReturnType<typeof vi.fn> };
};

const ALICE = {
  id: "u-alice",
  firstName: "Alice",
  lastName: "Smith",
  daliEmail: "alice@dali.dartmouth.edu",
  adminMembership: null,
  coreAssignments: [],
  domainLeadAssignmentsAsUser: [],
  domainEligibilities: [
    { domain: { displayName: "Fullstack Dev" } },
  ],
};

const BOB_CORE = {
  id: "u-bob",
  firstName: "Bob",
  lastName: "Jones",
  daliEmail: "bob@dali.dartmouth.edu",
  adminMembership: null,
  coreAssignments: [{ leadTitle: "Design Lead" }],
  domainLeadAssignmentsAsUser: [],
  domainEligibilities: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_members", () => {
  it("requires mcp:read scope", () => {
    expect(LIST_MEMBERS_DEF.requiredScope).toBe("mcp:read");
  });

  it("returns all current-term members (no filters)", async () => {
    mockUser.user.findMany.mockResolvedValue([ALICE, BOB_CORE]);
    const out = await runListMembers({});
    expect(out.members).toHaveLength(2);
    expect(out.count).toBe(2);
  });

  it("derives correct tier for a regular member", async () => {
    mockUser.user.findMany.mockResolvedValue([ALICE]);
    const out = await runListMembers({});
    expect(out.members[0].tier).toBe("member");
    expect(out.members[0].domains).toContain("Fullstack Dev");
  });

  it("derives correct tier for a Core member", async () => {
    mockUser.user.findMany.mockResolvedValue([BOB_CORE]);
    const out = await runListMembers({});
    expect(out.members[0].tier).toBe("core");
    expect(out.members[0].currentTermRoles).toContain("Design Lead");
  });

  it("applies tier filter in post-processing (member only)", async () => {
    mockUser.user.findMany.mockResolvedValue([ALICE, BOB_CORE]);
    const out = await runListMembers({ tier: "member" });
    expect(out.members).toHaveLength(1);
    expect(out.members[0].id).toBe("u-alice");
  });

  it("applies tier filter: core only", async () => {
    mockUser.user.findMany.mockResolvedValue([ALICE, BOB_CORE]);
    const out = await runListMembers({ tier: "core" });
    expect(out.members).toHaveLength(1);
    expect(out.members[0].id).toBe("u-bob");
  });

  it("passes limit to Prisma findMany", async () => {
    mockUser.user.findMany.mockResolvedValue([]);
    await runListMembers({ limit: 10 });
    expect(mockUser.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
  });

  it("caps limit at 100", async () => {
    mockUser.user.findMany.mockResolvedValue([]);
    await runListMembers({ limit: 999 });
    expect(mockUser.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it("returns empty list when no members match", async () => {
    mockUser.user.findMany.mockResolvedValue([]);
    const out = await runListMembers({});
    expect(out.members).toEqual([]);
    expect(out.count).toBe(0);
  });
});
