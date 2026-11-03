import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { page: { findMany: vi.fn() } } }));
vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccessBulk: vi.fn(),
  PAGE_ACCESS_SELECT: { id: true },
}));

import { prisma } from "~/lib/db.server";
import { requireMemberSession } from "~/lib/auth";
import { MAX_TABS } from "~/lib/desktop-tabs";
import { getPageAccessBulk } from "~/lib/pageAccess.server";
import { loader } from "../api.documents.emojis";

const findMany = prisma.page.findMany as unknown as ReturnType<typeof vi.fn>;

function get(query = "?ids=p1,p2") {
  return loader({
    request: new Request(`http://localhost/api/documents/emojis${query}`),
  } as any) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as any);
  findMany.mockResolvedValue([
    { id: "p1", iconEmoji: "🌲" },
    { id: "p2", iconEmoji: null },
  ]);
  vi.mocked(getPageAccessBulk).mockResolvedValue(
    new Map([
      ["p1", { canView: true }],
      ["p2", { canView: true }],
    ]) as any,
  );
});

describe("GET /api/documents/emojis", () => {
  it("returns each viewable page's emoji, null for one without", async () => {
    expect(await (await get()).json()).toEqual({ emojis: { p1: "🌲", p2: null } });
  });

  it("checks access for all the pages in one call", async () => {
    await get();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(getPageAccessBulk).toHaveBeenCalledTimes(1);
    expect(getPageAccessBulk).toHaveBeenCalledWith("u1", expect.any(Array), expect.any(Request));
  });

  it("leaves out a page the caller can't view", async () => {
    vi.mocked(getPageAccessBulk).mockResolvedValue(
      new Map([
        ["p1", { canView: false }],
        ["p2", { canView: true }],
      ]) as any,
    );
    expect(await (await get()).json()).toEqual({ emojis: { p2: null } });
  });

  it("reads no pages when no ids are given", async () => {
    expect(await (await get("")).json()).toEqual({ emojis: {} });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("de-duplicates ids and asks for no more than the tab limit", async () => {
    const many = Array.from({ length: MAX_TABS + 5 }, (_, i) => `p${i}`);
    await get(`?ids=p0,${many.join(",")}`);
    const asked = findMany.mock.calls[0][0].where.id.in;
    expect(asked).toHaveLength(MAX_TABS);
    expect(new Set(asked).size).toBe(MAX_TABS);
  });

  it("needs a member session", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as any);
    expect((await get()).status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });
});
