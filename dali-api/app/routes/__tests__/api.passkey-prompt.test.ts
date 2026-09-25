import { describe, it, expect, beforeEach, vi } from "vitest";

const mockCount = vi.hoisted(() => vi.fn());
vi.mock("~/lib/db", () => ({ prisma: { passkey: { count: mockCount } } }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({
  isFeatureEnabledForEveryone: vi.fn(),
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { logAuditEvent } from "~/lib/audit";
import { loader, action } from "~/routes/api.passkey-prompt";

const mockRequireAuth = vi.mocked(requireAuth);
const mockFlag = vi.mocked(isFeatureEnabledForEveryone);
const mockAudit = vi.mocked(logAuditEvent);

function get(cookie?: string) {
  return new Request("http://localhost/api/passkey-prompt", {
    headers: cookie ? { cookie } : {},
  });
}
function post(intent: string) {
  return new Request("http://localhost/api/passkey-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ intent }).toString(),
  });
}
function cookiesOf(res: Response): string[] {
  return res.headers.getSetCookie?.() ?? [res.headers.get("Set-Cookie") ?? ""];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ ok: true, user: { sub: "u1", type: "member" } } as any);
  mockFlag.mockResolvedValue(true);
  mockCount.mockResolvedValue(0 as any);
  mockAudit.mockResolvedValue(undefined as any);
});

describe("GET /api/passkey-prompt (eligibility)", () => {
  it("offers when authed, flag on, no passkey, not dismissed", async () => {
    expect(await loader({ request: get() } as any)).toEqual({ offer: true });
  });

  it("does not offer when unauthenticated", async () => {
    mockRequireAuth.mockResolvedValue({ ok: false } as any);
    expect(await loader({ request: get() } as any)).toEqual({ offer: false });
  });

  it("does not offer when the betterauth flag is off", async () => {
    mockFlag.mockResolvedValue(false);
    expect(await loader({ request: get() } as any)).toEqual({ offer: false });
  });

  it("does not offer when the user already has a passkey", async () => {
    mockCount.mockResolvedValue(1 as any);
    expect(await loader({ request: get() } as any)).toEqual({ offer: false });
  });

  it("does not offer (and skips the DB) when dismissed on this device", async () => {
    const result = await loader({ request: get("dali_pk_prompt=1") } as any);
    expect(result).toEqual({ offer: false });
    expect(mockCount).not.toHaveBeenCalled();
  });
});

describe("POST /api/passkey-prompt (act)", () => {
  it("dismiss sets the dismissal cookie", async () => {
    const res = (await action({ request: post("dismiss") } as any)) as Response;
    expect(cookiesOf(res).some((c) => c.includes("dali_pk_prompt=1"))).toBe(true);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("enrolled (passkey present) sets the cookie and audit-logs the registration", async () => {
    mockCount.mockResolvedValue(1 as any);
    const res = (await action({ request: post("enrolled") } as any)) as Response;
    expect(cookiesOf(res).some((c) => c.includes("dali_pk_prompt=1"))).toBe(true);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.passkey.register", userId: "u1" }),
    );
  });

  it("enrolled with no passkey present does nothing (no cookie, no audit)", async () => {
    mockCount.mockResolvedValue(0 as any);
    const res = (await action({ request: post("enrolled") } as any)) as Response;
    expect(cookiesOf(res).some((c) => c.includes("dali_pk_prompt=1"))).toBe(false);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated POST", async () => {
    mockRequireAuth.mockResolvedValue({ ok: false } as any);
    const res = (await action({ request: post("dismiss") } as any)) as Response;
    expect(res.status).toBe(401);
  });
});
