import { describe, it, expect, beforeEach, vi } from "vitest";

const mockIsFeatureEnabledForEveryone = vi.hoisted(() => vi.fn());
const mockRequireAuth = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db", () => ({ prisma: { partnerContact: { findUnique: vi.fn() } } }));
vi.mock("~/lib/betterauth.server", () => ({ auth: { api: {} } }));
vi.mock("~/lib/feature-flags.server", () => ({
  isFeatureEnabledForEveryone: mockIsFeatureEnabledForEveryone,
}));
vi.mock("~/lib/auth", () => ({ requireAuth: mockRequireAuth }));
vi.mock("~/partners/lib/magic-link.server", () => ({
  issuePartnerMagicLink: vi.fn(),
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
  classifyPartnerEmail: vi.fn(),
}));
vi.mock("~/partners/lib/partner-emails.server", () => ({
  sendMemberEmailConflictEmail: vi.fn(),
}));

import { loader } from "~/partners/routes/partner.login";

function req() {
  return new Request("http://localhost/partner/login");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ ok: false });
});

describe("GET /partner/login loader (flag-gated)", () => {
  it("flag ON + unauthenticated → redirects to the unified /login", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
    const res = (await loader({ request: req() } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("flag OFF + unauthenticated → renders the legacy partner login (no redirect)", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(false);
    const result = await loader({ request: req() } as any);
    expect(result).toEqual({ betterAuthOn: false });
  });
});
