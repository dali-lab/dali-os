import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({
  notify: vi.fn().mockResolvedValue({ inApp: 0, emailed: 0, slackDmed: 0 }),
}));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import {
  isLevelAdvance,
  notifyAdminsOfPromotion,
} from "~/lib/promotion-notify.server";

const mockPrisma = prisma as unknown as {
  adminMembership: { findMany: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
};
const notifyMock = notify as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_USER_IDS = "";
  (mockPrisma as any).adminMembership = {
    findMany: vi.fn().mockResolvedValue([{ userId: "a1" }, { userId: "a2" }]),
  };
  (mockPrisma as any).user = {
    findUnique: vi.fn().mockResolvedValue({ firstName: "Jane", lastName: "Doe" }),
  };
});

describe("isLevelAdvance", () => {
  it("is true only for an upward move from a known prior level", () => {
    expect(isLevelAdvance("P1", "P2")).toBe(true);
    expect(isLevelAdvance("P2", "P3")).toBe(true);
    expect(isLevelAdvance("P1", "P3")).toBe(true);
  });

  it("is false for initial grants (null prior), no-ops, and downgrades", () => {
    // A brand-new eligibility is an initial grant, not an advancement — this is
    // what keeps a new hire's first P1 silent.
    expect(isLevelAdvance(null, "P1")).toBe(false);
    expect(isLevelAdvance(null, "P3")).toBe(false);
    expect(isLevelAdvance("P2", "P2")).toBe(false);
    expect(isLevelAdvance("P3", "P1")).toBe(false);
  });
});

describe("notifyAdminsOfPromotion", () => {
  it("notifies every admin except the actor, titled with the member's name", async () => {
    await notifyAdminsOfPromotion({
      userId: "u1",
      actorId: "a1",
      summary: "was promoted to P3 in Design",
    });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const arg = notifyMock.mock.calls[0][0];
    expect(arg.eventType).toBe("member.promotion");
    expect(arg.createdByUserId).toBe("a1");
    expect(arg.message.title).toBe("Jane Doe was promoted to P3 in Design");
    expect(arg.message.link).toBe("/members/u1");
    expect(arg.recipients.map((r: { userId: string }) => r.userId)).toEqual(["a2"]);
  });

  it("unions ADMIN_USER_IDS env admins with AdminMembership rows", async () => {
    process.env.ADMIN_USER_IDS = "env1";
    (mockPrisma as any).adminMembership.findMany.mockResolvedValue([]);
    await notifyAdminsOfPromotion({
      userId: "u1",
      actorId: "someone",
      summary: "joined Core",
    });
    const arg = notifyMock.mock.calls[0][0];
    expect(arg.recipients.map((r: { userId: string }) => r.userId)).toEqual(["env1"]);
  });

  it("does not dispatch when the actor is the only admin", async () => {
    (mockPrisma as any).adminMembership.findMany.mockResolvedValue([{ userId: "a1" }]);
    await notifyAdminsOfPromotion({
      userId: "u1",
      actorId: "a1",
      summary: "joined Core",
    });
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
