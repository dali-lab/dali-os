import { describe, it, expect, beforeEach, vi } from "vitest";

const mockUpdateMany = vi.hoisted(() => vi.fn());
const mockFindFirst = vi.hoisted(() => vi.fn());
const mockLogAuditEvent = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db.server", () => ({
  prisma: {
    devicePairing: { updateMany: mockUpdateMany, findFirst: mockFindFirst },
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("~/lib/betterauth-session.server", () => ({
  mintBetterAuthSession: vi.fn().mockResolvedValue({ token: "ba-token", sessionId: "s1", expiresAt: new Date() }),
}));
vi.mock("~/lib/betterauth-cookie.server", () => ({
  appendBetterAuthSessionCookie: vi.fn(),
}));

import { loader } from "~/routes/auth.handoff";

function req(code = "handoff-code") {
  const params = new URLSearchParams({ code });
  return new Request(`http://localhost/auth/handoff?${params}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockFindFirst.mockResolvedValue({ userId: "user-1", deviceLabel: "macOS" });
});

describe("GET /auth/handoff", () => {
  const withNext = (next: string) =>
    new Request(`http://localhost/auth/handoff?${new URLSearchParams({ code: "handoff-code", next })}`);
  const load = (request: Request) => loader({ request, params: {}, context: {} } as any) as Promise<Response>;

  it("lands on / by default, as the desktop app expects", async () => {
    expect((await load(req())).headers.get("Location")).toBe("/");
  });

  it("lands on a same-origin next path, keeping its query", async () => {
    const res = await load(withNext("/documents/pg1?embed=1"));
    expect(res.headers.get("Location")).toBe("/documents/pg1?embed=1");
  });

  it.each(["https://evil.example/x", "//evil.example/x", "documents/pg1"])("ignores an off-site or relative next %j", async (next) => {
    expect((await load(withNext(next))).headers.get("Location")).toBe("/");
  });

  it("does not follow next when the code is invalid", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    expect((await load(withNext("/documents/pg1"))).headers.get("Location")).toBe("/login?error=handoff_invalid");
  });
});
