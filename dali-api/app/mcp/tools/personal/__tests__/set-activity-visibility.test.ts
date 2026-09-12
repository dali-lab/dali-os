import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
  },
}));

import { prisma } from "~/lib/db";
import {
  runSetActivityVisibility,
  SET_ACTIVITY_VISIBILITY_DEF,
} from "~/mcp/tools/personal/set-activity-visibility";

const mockPrisma = prisma as unknown as {
  user: { update: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("set_activity_visibility", () => {
  it("requires mcp:write scope", () => {
    expect(SET_ACTIVITY_VISIBILITY_DEF.requiredScope).toBe("mcp:write");
  });

  it("hides activity when hideActivity=true", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    const out = await runSetActivityVisibility("u-alice", { hideActivity: true });
    expect(out).toEqual({ ok: true, hideActivity: true });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "u-alice" },
      data: { hideActivity: true },
    });
  });

  it("shows activity when hideActivity=false", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    const out = await runSetActivityVisibility("u-alice", { hideActivity: false });
    expect(out).toEqual({ ok: true, hideActivity: false });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "u-alice" },
      data: { hideActivity: false },
    });
  });
});
