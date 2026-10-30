import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
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
import { isAdminViaEnv } from "~/lib/roles";
import { runListMembers, LIST_MEMBERS_DEF } from "~/mcp/tools/personal/list-members";

const mockUser = prisma as unknown as {
  user: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
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
    mockUser.user.count.mockResolvedValue(2);
    const out = await runListMembers({});
    expect(out.members).toHaveLength(2);
    expect(out.page).toMatchObject({ hasMore: false, nextCursor: null, total: 2 });
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

  it("applies tier filter before paging (member only)", async () => {
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

  it("overfetches one row for the limit and orders with an id tiebreak", async () => {
    mockUser.user.findMany.mockResolvedValue([]);
    await runListMembers({ limit: 10 });
    const call = mockUser.user.findMany.mock.calls[0][0];
    expect(call.take).toBe(11);
    expect(call.skip).toBe(0);
    expect(call.orderBy.at(-1)).toEqual({ id: "asc" });
  });

  it("caps limit at 100", async () => {
    mockUser.user.findMany.mockResolvedValue([]);
    await runListMembers({ limit: 999 });
    expect(mockUser.user.findMany.mock.calls[0][0].take).toBe(101);
  });

  it("walks pages with the cursor and ends with a null cursor", async () => {
    mockUser.user.count.mockResolvedValue(3);
    const rows = [ALICE, BOB_CORE, { ...ALICE, id: "u-cy", firstName: "Cy" }];
    mockUser.user.findMany.mockResolvedValueOnce(rows.slice(0, 3));
    const first = await runListMembers({ limit: 2 });
    expect(first.members).toHaveLength(2);
    expect(first.page).toMatchObject({ hasMore: true, total: 3 });

    mockUser.user.findMany.mockResolvedValueOnce(rows.slice(2));
    const second = await runListMembers({ limit: 2, cursor: first.page.nextCursor! });
    expect(mockUser.user.findMany.mock.calls[1][0].skip).toBe(2);
    expect(second.members.map((m) => m.id)).toEqual(["u-cy"]);
    expect(second.page).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("finds a core member that sits past the first page of the alphabet", async () => {
    const members = Array.from({ length: 120 }, (_, i) => ({
      ...ALICE,
      id: `u-${i}`,
      firstName: `M${i}`,
    }));
    const late = { ...BOB_CORE, id: "u-late" };
    mockUser.user.findMany.mockResolvedValue([...members, late]);
    const out = await runListMembers({ tier: "core" });
    expect(out.members.map((m) => m.id)).toEqual(["u-late"]);
    expect(out.page.total).toBe(1);
    expect(mockUser.user.findMany.mock.calls[0][0].take).toBeUndefined();
  });

  it("pages the tier-filtered set, counting env admins as admin", async () => {
    vi.mocked(isAdminViaEnv).mockImplementation((id: string) => id === "u-env" || id === "u-env2");
    mockUser.user.findMany.mockResolvedValue([
      ALICE,
      { ...ALICE, id: "u-env" },
      BOB_CORE,
      { ...ALICE, id: "u-env2" },
    ]);
    const first = await runListMembers({ tier: "admin", limit: 1 });
    expect(first.members.map((m) => m.id)).toEqual(["u-env"]);
    expect(first.page).toMatchObject({ hasMore: true, total: 2 });
    const second = await runListMembers({ tier: "admin", limit: 1, cursor: first.page.nextCursor! });
    expect(second.members.map((m) => m.id)).toEqual(["u-env2"]);
    expect(second.page.nextCursor).toBeNull();
    vi.mocked(isAdminViaEnv).mockReturnValue(false);
  });

  it("returns empty list when no members match", async () => {
    mockUser.user.count.mockResolvedValue(0);
    mockUser.user.findMany.mockResolvedValue([]);
    const out = await runListMembers({});
    expect(out.members).toEqual([]);
    expect(out.page.total).toBe(0);
  });
});
