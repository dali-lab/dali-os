import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth");
vi.mock("~/lib/db");
vi.mock("~/lib/gmail", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { sendEmail } from "~/lib/gmail";
import { _resetForTests } from "~/lib/rate-limit";
import { action } from "~/routes/api.email.send";

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

const mockPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
};

function makeRequest() {
  return new Request("http://localhost/api/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: "x@y.com", subject: "Hi", html: "<p>hi</p>" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTests();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "user" },
  } as any);
  (mockPrisma as any).user = {
    findUnique: vi.fn().mockResolvedValue({ googleRefreshToken: "refresh-token" }),
  };
});

describe("POST /api/email/send rate limiting", () => {
  it("allows requests under the limit", async () => {
    for (let i = 0; i < 100; i++) {
      const res = await action({ request: makeRequest() } as any);
      expect(res.status).toBe(200);
    }
    expect(sendEmail).toHaveBeenCalledTimes(100);
  });

  it("returns 429 with Retry-After once the limit is exceeded", async () => {
    for (let i = 0; i < 100; i++) {
      await action({ request: makeRequest() } as any);
    }
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("scopes the rate limit per user", async () => {
    for (let i = 0; i < 100; i++) {
      await action({ request: makeRequest() } as any);
    }
    const limited = await action({ request: makeRequest() } as any);
    expect(limited.status).toBe(429);

    vi.mocked(requireAuth).mockResolvedValueOnce({
      ok: true,
      user: { sub: OTHER_USER_ID, email: "o@x.com", type: "user" },
    } as any);
    const ok = await action({ request: makeRequest() } as any);
    expect(ok.status).toBe(200);
  });

  it("returns 401 without consuming rate-limit budget when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as any);
    for (let i = 0; i < 15; i++) {
      const res = await action({ request: makeRequest() } as any);
      expect(res.status).toBe(401);
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
