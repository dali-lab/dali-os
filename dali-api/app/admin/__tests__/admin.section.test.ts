import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ resolveFeatureFlags: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302, headers: { Location: "/login" } })) }));

import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { resolveFeatureFlags } from "~/lib/feature-flags.server";
import { loader } from "~/admin/routes/admin.section";
import { loader as legacyLoader } from "~/admin/routes/admin.legacy-redirect";

const run = (url: string) =>
  loader({ request: new Request(`http://localhost${url}`), params: {}, context: {} } as never) as Promise<Response>;

function as(roles: { isCore: boolean; isAdmin: boolean }, flags: Record<string, boolean> = {}) {
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(getUserRoles).mockResolvedValue(roles as never);
  vi.mocked(resolveFeatureFlags).mockResolvedValue(flags as never);
}

beforeEach(() => vi.clearAllMocks());

describe("admin section URL", () => {
  it("opens the first tab and keeps the query", async () => {
    as({ isCore: true, isAdmin: true });
    const res = await run("/admin/payroll?term=t1");
    expect(res.headers.get("Location")).toBe("/admin/payroll/hire-setup?term=t1");
  });

  it("skips a tab the viewer can't open", async () => {
    as({ isCore: true, isAdmin: false });
    expect((await run("/admin/accounts")).headers.get("Location")).toBe("/admin/accounts/security");
  });

  it("sends a Core member away from an admin-only section", async () => {
    as({ isCore: true, isAdmin: false });
    expect((await run("/admin/payroll")).headers.get("Location")).toBe("/admin");
  });

  it("sends non-Core members home", async () => {
    as({ isCore: false, isAdmin: false });
    expect((await run("/admin/messaging")).headers.get("Location")).toBe("/");
  });
});

describe("legacy admin redirect", () => {
  it("permanently forwards with the query and hash", async () => {
    const res = (await legacyLoader({
      request: new Request("http://localhost/admin/outbound-messages?status=Dead&q=x#top"),
      params: {},
      context: {},
    } as never)) as Response;
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/admin/messaging/outbox?status=Dead&q=x#top");
  });
});
