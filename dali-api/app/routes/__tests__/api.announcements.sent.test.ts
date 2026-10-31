import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/groups", () => ({ listVisibleGroupsForUser: vi.fn() }));
vi.mock("~/core/lib/announcements-sent.server", () => ({ loadSentAnnouncements: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { listVisibleGroupsForUser } from "~/lib/groups";
import { loadSentAnnouncements } from "~/core/lib/announcements-sent.server";
import { loader } from "~/routes/api.announcements.sent";

function call(qs = "") {
  return loader({ request: new Request(`http://localhost/api/announcements/sent${qs}`), params: {}, context: {} } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "ada" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(listVisibleGroupsForUser).mockResolvedValue([{ id: "g1", name: "Design" }] as never);
  vi.mocked(loadSentAnnouncements).mockResolvedValue({ items: [], nextCursor: null } as never);
});

describe("api.announcements.sent", () => {
  it("rejects signed-out and non-Core viewers", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    expect((await call()).status).toBe(401);
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "ada" } } as never);
    vi.mocked(isCore).mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    expect(loadSentAnnouncements).not.toHaveBeenCalled();
  });

  it("loads the next page with the viewer's visible groups", async () => {
    await call("?cursor=abc");
    const [cursor, groups] = vi.mocked(loadSentAnnouncements).mock.calls[0];
    expect(cursor).toBe("abc");
    expect(groups.get("g1")).toEqual({ id: "g1", name: "Design" });
  });
});
