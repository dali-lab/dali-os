// Impersonation is read-only, enforced at requireAuth rather than per route:
// ~250 action modules share that entry point, so the default for new code is
// deny. Exercises requireAuth end-to-end with the BetterAuth leg mocked (the
// legacy leg is left to fail naturally — no cookie, so no credential).

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockFlagForEveryone = vi.hoisted(() => vi.fn());
const mockResolveBetterAuthAuth = vi.hoisted(() => vi.fn());
const mockGetBetterAuthUser = vi.hoisted(() => vi.fn());
const mockStopImpersonating = vi.hoisted(() => vi.fn());

vi.mock("~/lib/feature-flags.server", () => ({
  isFeatureEnabledForEveryone: mockFlagForEveryone,
}));
vi.mock("~/lib/betterauth-compat.server", () => ({
  resolveBetterAuthAuth: mockResolveBetterAuthAuth,
  getBetterAuthUser: mockGetBetterAuthUser,
}));
vi.mock("~/lib/betterauth.server", () => ({
  auth: { api: { stopImpersonating: mockStopImpersonating } },
}));
vi.mock("~/lib/db", () => ({ prisma: {} }));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isDomainLead: vi.fn(),
  isProjectMember: vi.fn(),
}));
vi.mock("~/lib/session", () => ({
  lookupSession: vi.fn().mockResolvedValue(null),
  rollSession: vi.fn(),
  hashSessionId: (s: string) => s,
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { requireAuth } from "~/lib/auth";

const USER = { sub: "member-1", email: "m@dali.dartmouth.edu", type: "member" };

function req(method: string) {
  return new Request("http://x/api/anything", {
    method,
    ...(method === "GET" || method === "HEAD" ? {} : { body: new FormData() }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFlagForEveryone.mockResolvedValue(true);
  delete process.env.DALI_APP_ENV;
});

function impersonated() {
  mockResolveBetterAuthAuth.mockResolvedValue({
    user: USER,
    sessionId: "s1",
    impersonatedBy: "admin-9",
  });
}
function ownSession() {
  mockResolveBetterAuthAuth.mockResolvedValue({ user: USER, sessionId: "s1" });
}

describe("requireAuth on an impersonated session", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("refuses %s with a 403", async (method) => {
    impersonated();

    const result = await requireAuth(req(method));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.reason).toBe("impersonated_write");
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toMatchObject({ reason: "impersonating" });
  });

  it.each(["GET", "HEAD"])("allows %s", async (method) => {
    impersonated();

    expect((await requireAuth(req(method))).ok).toBe(true);
  });

  it("allows an opted-out POST that only reads", async () => {
    impersonated();

    const result = await requireAuth(req("POST"), { allowImpersonatedWrite: true });

    expect(result.ok).toBe(true);
  });

  it("does not let an opt-out poison the memoized result for another caller", async () => {
    impersonated();
    const request = req("POST");

    expect((await requireAuth(request, { allowImpersonatedWrite: true })).ok).toBe(true);
    // Same request object, no opt-out: still refused.
    expect((await requireAuth(request)).ok).toBe(false);
  });
});

// Staging is where a flow gets tested end to end as a member, so the gate
// opens there and only there.
describe("requireAuth on an impersonated session, per environment", () => {
  it("allows writes on staging", async () => {
    process.env.DALI_APP_ENV = "staging";
    impersonated();

    expect((await requireAuth(req("POST"))).ok).toBe(true);
  });

  it.each(["prod", "dev"])("still refuses writes on %s", async (env) => {
    process.env.DALI_APP_ENV = env;
    impersonated();

    const result = await requireAuth(req("POST"));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.reason).toBe("impersonated_write");
  });
});

describe("requireAuth on the member's own session", () => {
  it("allows writes", async () => {
    ownSession();

    expect((await requireAuth(req("POST"))).ok).toBe(true);
  });
});

// The write gate must never trap an admin inside a session they cannot leave.
// /admin/stop-impersonating resolves its own session via getBetterAuthUser, so
// it does not pass through requireAuth at all — this pins that.
describe("/admin/stop-impersonating", () => {
  it("still works from an impersonated session, despite being a POST", async () => {
    impersonated();
    mockGetBetterAuthUser.mockResolvedValue({ sub: "member-1" });
    mockStopImpersonating.mockResolvedValue({
      headers: new Headers({ "set-cookie": "dali.session_token=restored" }),
    });
    const { action } = await import("~/routes/admin.stop-impersonating");

    const res = await action({ request: req("POST") });

    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toContain("restored");
    expect(mockStopImpersonating).toHaveBeenCalledTimes(1);
  });
});
