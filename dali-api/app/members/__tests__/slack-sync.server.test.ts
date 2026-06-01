import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/slack/lib/slack-client", () => ({
  lookupSlackUserByEmail: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { lookupSlackUserByEmail } from "~/slack/lib/slack-client";
import { syncSlackUserId } from "~/members/lib/slack-sync.server";

const mockPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).user = { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) };
});

describe("syncSlackUserId", () => {
  it("no-ops when slackUserId is already set", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ slackUserId: "U1", daliEmail: "a@x" });
    const res = await syncSlackUserId("u1");
    expect(res).toEqual({ status: "ok", slackUserId: "U1" });
    expect(lookupSlackUserByEmail).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("resolves + stores the slack id from the dali email", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      slackUserId: null,
      daliEmail: "riley@dali.dartmouth.edu",
      dartmouthEmail: null,
      personalEmail: null,
    });
    vi.mocked(lookupSlackUserByEmail).mockResolvedValue("U9");
    const res = await syncSlackUserId("u1");
    expect(lookupSlackUserByEmail).toHaveBeenCalledWith("riley@dali.dartmouth.edu");
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { slackUserId: "U9" },
    });
    expect(res).toEqual({ status: "ok", slackUserId: "U9" });
  });

  it("falls back to the dartmouth email when dali has no match", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      slackUserId: null,
      daliEmail: "riley@dali.dartmouth.edu",
      dartmouthEmail: "riley@dartmouth.edu",
      personalEmail: null,
    });
    vi.mocked(lookupSlackUserByEmail)
      .mockResolvedValueOnce(null) // dali — no match
      .mockResolvedValueOnce("U7"); // dartmouth — match
    const res = await syncSlackUserId("u1");
    expect(lookupSlackUserByEmail).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ status: "ok", slackUserId: "U7" });
  });

  it("skips when no email resolves to a Slack account", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      slackUserId: null,
      daliEmail: "riley@dali.dartmouth.edu",
      dartmouthEmail: null,
      personalEmail: null,
    });
    vi.mocked(lookupSlackUserByEmail).mockResolvedValue(null);
    const res = await syncSlackUserId("u1");
    expect(res).toEqual({ status: "skipped", slackUserId: null });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
