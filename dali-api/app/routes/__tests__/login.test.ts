import { describe, it, expect, beforeEach, vi } from "vitest";

// `~/routes/login` transitively imports `~/lib/auth`, which now reaches into
// `~/lib/oauth` for the silent-refresh path; `oauth` imports the real Prisma
// client. Mocking `~/lib/db` keeps these tests Prisma-free.
vi.mock("~/lib/db");

import { _resetForTests } from "~/lib/rate-limit";
import { action } from "~/routes/login";

function makeRequest(ip = "1.2.3.4") {
  const form = new URLSearchParams({
    provider: "google",
  });
  return new Request("http://localhost/login", {
    method: "POST",
    headers: {
      "X-Forwarded-For": ip,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
}

beforeEach(() => {
  _resetForTests();
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
});

describe("POST /login rate limiting", () => {
  it("allows requests under the limit", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await action({ request: makeRequest() } as any);
      expect(res.status).toBe(302);
    }
  });

  it("returns 429 with Retry-After once the limit is exceeded", async () => {
    for (let i = 0; i < 5; i++) {
      await action({ request: makeRequest() } as any);
    }
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("scopes the rate limit per IP", async () => {
    for (let i = 0; i < 5; i++) {
      await action({ request: makeRequest("1.2.3.4") } as any);
    }
    const limited = await action({ request: makeRequest("1.2.3.4") } as any);
    expect(limited.status).toBe(429);

    const ok = await action({ request: makeRequest("5.6.7.8") } as any);
    expect(ok.status).toBe(302);
  });
});
