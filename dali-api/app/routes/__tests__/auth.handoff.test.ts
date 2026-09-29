import { describe, it, expect, beforeEach, vi } from "vitest";

const mockUpdateMany = vi.hoisted(() => vi.fn());
const mockFindFirst = vi.hoisted(() => vi.fn());
const mockIssueSession = vi.hoisted(() => vi.fn());
const mockLogAuditEvent = vi.hoisted(() => vi.fn());
const mockIsFeatureEnabledForEveryone = vi.hoisted(() => vi.fn().mockResolvedValue(false));

vi.mock("~/lib/db", () => ({
  prisma: {
    devicePairing: { updateMany: mockUpdateMany, findFirst: mockFindFirst },
  },
}));
vi.mock("~/lib/session", () => ({ issueSession: mockIssueSession }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("~/lib/feature-flags.server", () => ({
  isFeatureEnabledForEveryone: mockIsFeatureEnabledForEveryone,
}));
vi.mock("~/lib/betterauth-session.server", () => ({
  mintBetterAuthSession: vi.fn(),
}));
vi.mock("~/lib/betterauth-cookie.server", () => ({
  appendBetterAuthSessionCookie: vi.fn(),
}));

import { loader } from "~/routes/auth.handoff";
import { TABLESS_COOKIE } from "~/lib/tabless";

function req(cookie?: string, code = "handoff-code") {
  const params = new URLSearchParams({ code });
  return new Request(`http://localhost/auth/handoff?${params}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockFindFirst.mockResolvedValue({ userId: "user-1", deviceLabel: "macOS" });
  mockIssueSession.mockResolvedValue({ rawId: "raw-session-id" });
});

describe("GET /auth/handoff", () => {
  it("plants no tabless preference — a fresh desktop pairing rides the tabless default", async () => {
    const res = await loader({ request: req(), params: {}, context: {} } as any);
    const setCookies = res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : [...res.headers.entries()].filter(([k]) => k === "set-cookie").map(([, v]) => v);
    expect(setCookies.some((c) => c.startsWith(`${TABLESS_COOKIE}=`))).toBe(false);
  });

  it("leaves a device's existing preference untouched", async () => {
    const res = await loader({
      request: req(`${TABLESS_COOKIE}=0`),
      params: {},
      context: {},
    } as any);
    const setCookies = res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : [...res.headers.entries()].filter(([k]) => k === "set-cookie").map(([, v]) => v);
    expect(setCookies.some((c) => c.startsWith(`${TABLESS_COOKIE}=`))).toBe(false);
  });
});
