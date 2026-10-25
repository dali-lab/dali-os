import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { featureFlag: { findMany: vi.fn() }, user: { findMany: vi.fn() } },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isAdmin: vi.fn(),
  currentTermMemberWhere: vi.fn(),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/feature-flags.server", () => ({ listFlagsForAdmin: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isCore, currentTermMemberWhere } from "~/lib/roles";
import { listFlagsForAdmin } from "~/lib/feature-flags.server";
import {
  flagTargetSummary,
  loader,
  matchesFlagQuery,
  needsEveryoneConfirm,
} from "~/admin/routes/admin.feature-flags";

import type { RoleTarget } from "~/lib/feature-flags";

const base: { enabled: boolean; everyone: boolean; roles: RoleTarget[]; userIds: string[] } = {
  enabled: true,
  everyone: false,
  roles: [],
  userIds: [],
};

describe("flagTargetSummary", () => {
  it("reads Off whenever the master switch is off, whatever the targeting", () => {
    expect(flagTargetSummary({ ...base, enabled: false, everyone: true })).toBe("Off");
  });
  it("reads Everyone over any role or person targeting", () => {
    expect(flagTargetSummary({ ...base, everyone: true, roles: ["isCore"], userIds: ["u1"] })).toBe("Everyone");
  });
  it("lists roles by label, then counts people", () => {
    expect(flagTargetSummary({ ...base, roles: ["isCore", "isAdmin"] })).toBe("Core, Admin");
    expect(flagTargetSummary({ ...base, userIds: ["a"] })).toBe("1 person");
    expect(flagTargetSummary({ ...base, userIds: ["a", "b", "c"] })).toBe("3 people");
    expect(flagTargetSummary({ ...base, roles: ["isStaff"], userIds: ["a", "b"] })).toBe("Staff + 2 people");
  });
  it("reads No one when on with no target", () => {
    expect(flagTargetSummary(base)).toBe("No one");
  });
});

describe("needsEveryoneConfirm", () => {
  it("confirms only when Everyone goes from off to on", () => {
    expect(needsEveryoneConfirm({ everyone: true }, { everyone: false })).toBe(true);
    expect(needsEveryoneConfirm({ everyone: true }, { everyone: true })).toBe(false);
    expect(needsEveryoneConfirm({ everyone: false }, { everyone: true })).toBe(false);
    expect(needsEveryoneConfirm({ everyone: false }, { everyone: false })).toBe(false);
  });
});

describe("matchesFlagQuery", () => {
  const flag = { key: "desktop-app", label: "Desktop app", description: "Native shell download" };
  it("matches key, label and description, case-insensitively", () => {
    expect(matchesFlagQuery(flag, "")).toBe(true);
    expect(matchesFlagQuery(flag, "  DESKTOP ")).toBe(true);
    expect(matchesFlagQuery(flag, "shell")).toBe(true);
    expect(matchesFlagQuery(flag, "billing")).toBe(false);
  });
});

describe("admin.feature-flags loader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isAdmin).mockResolvedValue(true);
    vi.mocked(currentTermMemberWhere).mockResolvedValue({} as never);
    vi.mocked(listFlagsForAdmin).mockResolvedValue([]);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "m1", firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@dali" },
    ] as never);
  });

  it("returns each saved flag's last update and the viewer's admin status", async () => {
    vi.mocked(prisma.featureFlag.findMany).mockResolvedValue([
      { key: "desktop-app", updatedAt: new Date("2026-10-01T12:00:00Z") },
    ] as never);
    const data = (await loader({ request: new Request("http://x/admin/platform/flags"), params: {}, context: {} } as never)) as any;
    expect(data.updatedAt).toEqual({ "desktop-app": "2026-10-01T12:00:00.000Z" });
    expect(data.viewerIsAdmin).toBe(true);
    expect(data.members).toEqual([{ id: "m1", name: "Ada Lovelace", email: "ada@dali" }]);
  });

  it("sends non-Core viewers home", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = (await loader({ request: new Request("http://x/admin/platform/flags"), params: {}, context: {} } as never)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });
});
