import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { user: { findMany: vi.fn(), count: vi.fn() } } }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn(), isAdminViaEnv: vi.fn(() => false) }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (u: string | null) => u) }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { SITE_USER_KINDS, kindOf, kindWhere, loader } from "~/admin/routes/admin.site-users";

const findMany = vi.mocked(prisma.user.findMany);
const count = vi.mocked(prisma.user.count);

function load(qs = "") {
  return loader({
    request: new Request(`http://localhost/admin/accounts/users${qs}`),
    params: {},
    context: {},
  } as never) as Promise<any>;
}

function user(over: Record<string, unknown> = {}) {
  return {
    id: "u2",
    firstName: "Ada",
    lastName: "Lovelace",
    daliEmail: null,
    dartmouthEmail: null,
    personalEmail: "ada@example.com",
    email: null,
    netId: null,
    photoUrl: null,
    banned: false,
    membershipStatus: "Active",
    lastActiveAt: null,
    hideActivity: false,
    daliMember: null,
    adminMembership: null,
    partnerContact: null,
    ...over,
  };
}

// Counts in SITE_USER_KINDS order: Member, Alumni, Partner, Dartmouth, External.
const KIND_COUNTS = [4, 3, 2, 1, 5];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "admin-1" } } as never);
  vi.mocked(isAdmin).mockResolvedValue(true);
  findMany.mockResolvedValue([] as never);
  let i = 0;
  count.mockImplementation((async () => KIND_COUNTS[i++ % KIND_COUNTS.length]) as never);
});

describe("kindOf", () => {
  const base = { daliMember: null, membershipStatus: "Active", partnerContact: null, netId: null, dartmouthEmail: null };
  it("ranks membership over partner over Dartmouth", () => {
    expect(kindOf({ ...base, daliMember: {}, partnerContact: {}, netId: "f00" })).toBe("Member");
    expect(kindOf({ ...base, daliMember: {}, membershipStatus: "Alumni" })).toBe("Alumni");
    expect(kindOf({ ...base, partnerContact: {}, netId: "f00" })).toBe("Partner");
    expect(kindOf({ ...base, netId: "f00" })).toBe("Dartmouth");
    expect(kindOf({ ...base, dartmouthEmail: "a@dartmouth.edu" })).toBe("Dartmouth");
    expect(kindOf(base)).toBe("External");
  });
});

describe("kindWhere", () => {
  it("builds the exact inverse of kindOf for each kind", () => {
    expect(kindWhere("Member")).toEqual({ daliMember: { isNot: null }, membershipStatus: { not: "Alumni" } });
    expect(kindWhere("Alumni")).toEqual({ daliMember: { isNot: null }, membershipStatus: "Alumni" });
    expect(kindWhere("Partner")).toEqual({ daliMember: { is: null }, partnerContact: { isNot: null } });
    expect(kindWhere("Dartmouth")).toEqual({
      AND: [
        { daliMember: { is: null } },
        { partnerContact: { is: null } },
        { OR: [{ netId: { not: null } }, { dartmouthEmail: { not: null } }] },
      ],
    });
    expect(kindWhere("External")).toEqual({
      AND: [{ daliMember: { is: null } }, { partnerContact: { is: null } }, { netId: null }, { dartmouthEmail: null }],
    });
  });
});

describe("admin.site-users loader", () => {
  it("sends a non-admin away", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    const res = (await load()) as Response;
    expect(res.headers.get("Location")).toBe("/");
  });

  it("counts every kind for the current search and totals them when no kind is picked", async () => {
    const data = await load("?q=ada");
    expect(data.counts).toEqual({ Member: 4, Alumni: 3, Partner: 2, Dartmouth: 1, External: 5 });
    expect(data.all).toBe(15);
    expect(data.total).toBe(15);
    expect(data.kind).toBeNull();

    expect(count).toHaveBeenCalledTimes(SITE_USER_KINDS.length);
    const where = count.mock.calls[0][0]!.where as any;
    expect(where.AND[0].OR).toContainEqual({ firstName: { contains: "ada", mode: "insensitive" } });
    expect(where.AND[0].OR).toContainEqual({ netId: { contains: "ada", mode: "insensitive" } });
    expect(where.AND[1]).toEqual(kindWhere("Member"));

    expect(findMany.mock.calls[0][0]!.where).toEqual(where.AND[0]);
    expect(findMany.mock.calls[0][0]!.take).toBe(51);
    expect(findMany.mock.calls[0][0]!.skip).toBe(0);
  });

  it("pages by offset with an id tiebreak and reports whether another page follows", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => user({ id: `u${i}` }));
    findMany.mockResolvedValue(rows as never);
    const data = await load("?page=3");
    const args = findMany.mock.calls[0][0]!;
    expect(args.skip).toBe(100);
    expect(args.take).toBe(51);
    expect(args.orderBy).toEqual([
      { lastActiveAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    expect(data.users).toHaveLength(50);
    expect(data.page).toBe(3);
    expect(data.hasNext).toBe(true);
  });

  it("treats a bad page as page one and reports no next page on a short result", async () => {
    findMany.mockResolvedValue([user()] as never);
    const data = await load("?page=-4");
    expect(findMany.mock.calls[0][0]!.skip).toBe(0);
    expect(data.page).toBe(1);
    expect(data.hasNext).toBe(false);
  });

  it("applies ?kind= to the rows and reports that kind's count as the total", async () => {
    const data = await load("?q=ada&kind=Partner");
    expect(data.kind).toBe("Partner");
    expect(data.total).toBe(2);
    expect(data.all).toBe(15);
    const where = findMany.mock.calls[0][0]!.where as any;
    expect(where.AND[1]).toEqual(kindWhere("Partner"));
  });

  it("ignores an unknown kind", async () => {
    const data = await load("?kind=Robots");
    expect(data.kind).toBeNull();
    expect(findMany.mock.calls[0][0]!.where).toEqual({});
  });

  it("reports last seen, online inside five minutes, and hides it for members who hide activity", async () => {
    const now = Date.now();
    findMany.mockResolvedValue([
      user({ id: "a", lastActiveAt: new Date(now - 60_000) }),
      user({ id: "b", lastActiveAt: new Date(now - 3 * 60 * 60_000) }),
      user({ id: "c", lastActiveAt: null }),
      user({ id: "d", lastActiveAt: new Date(now - 60_000), hideActivity: true }),
    ] as never);
    const data = await load();
    const byId = Object.fromEntries(data.users.map((u: any) => [u.id, u.lastSeen]));
    expect(byId.a).toMatchObject({ hidden: false, online: true });
    expect(byId.b).toEqual({ hidden: false, online: false, at: new Date(now - 3 * 60 * 60_000).toISOString() });
    expect(byId.c).toEqual({ hidden: false, online: false, at: null });
    expect(byId.d).toEqual({ hidden: true, online: false, at: null });
  });

  it("orders by most recent activity and labels kind, admin and banned", async () => {
    findMany.mockResolvedValue([
      user({ id: "m", daliMember: { id: "dm" }, adminMembership: { id: "am" }, banned: true }),
    ] as never);
    const data = await load();
    expect(findMany.mock.calls[0][0]!.orderBy).toEqual([
      { lastActiveAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    expect(data.users[0]).toMatchObject({ kind: "Member", isAdmin: true, banned: true, email: "ada@example.com" });
    expect(data.viewerUserId).toBe("admin-1");
  });
});
