import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/members/lib/slack-sync.server", () => ({
  syncSlackUserId: vi.fn(),
}));
vi.mock("~/slack/lib/slack-client", () => ({
  slackConfigured: vi.fn(() => true),
}));

import { prisma } from "~/lib/db";
import { syncSlackUserId } from "~/members/lib/slack-sync.server";
import { slackConfigured } from "~/slack/lib/slack-client";
import { runSlackIdentitySync } from "~/jobs/slack-identity-sync.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockSync = syncSlackUserId as unknown as ReturnType<typeof vi.fn>;
const mockConfigured = slackConfigured as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-08-18T12:00:00Z");
const ctx = (maxApiPerRun = 200) => ({
  now: NOW,
  lastSuccessAt: null,
  settings: { maxApiPerRun },
});

beforeEach(() => {
  vi.resetAllMocks();
  mockConfigured.mockReturnValue(true);
});

describe("runSlackIdentitySync", () => {
  it("looks up only unlinked members and counts the newly linked", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }, { id: "u3" }]);
    mockSync
      .mockResolvedValueOnce({ status: "ok", slackUserId: "U1" })
      .mockResolvedValueOnce({ status: "skipped", slackUserId: null })
      .mockResolvedValueOnce({ status: "ok", slackUserId: "U3" });

    const result = await runSlackIdentitySync(ctx());

    expect(result.items).toBe(2);
    expect(result.note).toBe("3 checked, 2 newly linked");
    // Already-linked users are excluded in the query, not re-checked in code —
    // that's what keeps the Slack API cost proportional to the backlog.
    const where = mockPrisma.user.findMany.mock.calls[0][0].where;
    expect(where.slackUserId).toBeNull();
    // Members and provisioned hires only; applicants/partners are out of scope.
    expect(where.OR).toEqual([
      { daliMember: { isNot: null } },
      { daliEmail: { not: null } },
    ]);
    // Someone with no email at all has nothing to look up.
    expect(where.NOT).toEqual({
      daliEmail: null,
      dartmouthEmail: null,
      personalEmail: null,
    });
  });

  it("caps lookups at maxApiPerRun and says so when it hits the cap", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    mockSync.mockResolvedValue({ status: "ok", slackUserId: "U9" });

    const result = await runSlackIdentitySync(ctx(2));

    expect(mockPrisma.user.findMany.mock.calls[0][0].take).toBe(2);
    expect(result.note).toContain("hit the per-run cap");
  });

  it("keeps sweeping when one lookup throws", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    mockSync
      .mockRejectedValueOnce(new Error("slack blew up"))
      .mockResolvedValueOnce({ status: "ok", slackUserId: "U2" });

    const result = await runSlackIdentitySync(ctx());

    expect(mockSync).toHaveBeenCalledTimes(2);
    expect(result.items).toBe(1);
  });

  it("no-ops without a bot token instead of burning a tick on failed lookups", async () => {
    mockConfigured.mockReturnValue(false);

    const result = await runSlackIdentitySync(ctx());

    expect(result).toEqual({ items: 0, note: "SLACK_BOT_TOKEN not set — skipped." });
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });
});
