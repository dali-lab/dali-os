import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth");
vi.mock("~/lib/s3", () => ({
  getUploadUrl: vi.fn(),
  getDownloadUrl: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { getUploadUrl } from "~/lib/s3";
import { _resetForTests } from "~/lib/rate-limit";
import { action } from "~/routes/api.upload.presign";

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

function makeRequest(body: unknown = { key: "foo.png", contentType: "image/png" }) {
  return new Request("http://localhost/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTests();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "user" },
  } as any);
  vi.mocked(getUploadUrl).mockResolvedValue("https://s3.example/signed");
});

describe("POST /api/upload/presign rate limiting", () => {
  it("allows requests under the limit", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await action({ request: makeRequest() } as any);
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 with Retry-After once the limit is exceeded", async () => {
    for (let i = 0; i < 20; i++) {
      await action({ request: makeRequest() } as any);
    }
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("scopes the rate limit per user", async () => {
    for (let i = 0; i < 20; i++) {
      await action({ request: makeRequest() } as any);
    }
    // First user is now rate-limited.
    const limited = await action({ request: makeRequest() } as any);
    expect(limited.status).toBe(429);

    // A different user should still be allowed through.
    vi.mocked(requireAuth).mockResolvedValueOnce({
      ok: true,
      user: { sub: OTHER_USER_ID, email: "o@x.com", type: "user" },
    } as any);
    const ok = await action({ request: makeRequest() } as any);
    expect(ok.status).toBe(200);
  });

  it("returns 401 without consuming rate-limit budget when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as any);
    for (let i = 0; i < 25; i++) {
      const res = await action({ request: makeRequest() } as any);
      expect(res.status).toBe(401);
    }
  });
});
