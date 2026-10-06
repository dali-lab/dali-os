import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(async () => true),
}));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async () => ({ id: "om-test", deduped: false })),
  drainNow: vi.fn(async () => {}),
}));

import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { _resetForTests } from "~/lib/rate-limit";
import { action } from "~/routes/api.email.send";

const mockEnqueue = enqueueOutbound as unknown as ReturnType<typeof vi.fn>;
const mockDrain = drainNow as unknown as ReturnType<typeof vi.fn>;

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

const mockPrisma = prisma as unknown as {
  gmailIntegration: { findFirst: ReturnType<typeof vi.fn> };
};

function makeRequest(
  overrides: { to?: string; subject?: string; html?: string } = {},
) {
  const payload = {
    to: overrides.to ?? "x@y.com",
    subject: overrides.subject ?? "Hi",
    html: overrides.html ?? "<p>hi</p>",
  };
  return new Request("http://localhost/api/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTests();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "user" },
  } as any);
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("POST /api/email/send rate limiting", () => {
  it("allows requests under the limit", async () => {
    for (let i = 0; i < 100; i++) {
      const res = await action({ request: makeRequest() } as any);
      expect(res.status).toBe(200);
    }
    expect(mockEnqueue).toHaveBeenCalledTimes(100);
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
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe("POST /api/email/send recipient and header validation", () => {
  it("accepts a syntactically valid recipient", async () => {
    const res = await action({ request: makeRequest({ to: "applicant@example.com" }) } as any);
    expect(res.status).toBe(200);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const call = mockEnqueue.mock.calls[0][0];
    expect(call.channel).toBe("email");
    expect(call.target).toBe("applicant@example.com");
  });

  it("rejects a recipient missing an @", async () => {
    const res = await action({ request: makeRequest({ to: "not-an-email" }) } as any);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid recipient email" });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("rejects a recipient missing a TLD", async () => {
    const res = await action({ request: makeRequest({ to: "user@host" }) } as any);
    expect(res.status).toBe(400);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("rejects CRLF in the recipient", async () => {
    const res = await action({
      request: makeRequest({ to: "x@y.com\r\nBcc: attacker@evil.com" }),
    } as any);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "to and subject must not contain line breaks",
    });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("rejects CRLF in the subject", async () => {
    const res = await action({
      request: makeRequest({ subject: "Hi\r\nReply-To: attacker@evil.com" }),
    } as any);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "to and subject must not contain line breaks",
    });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("rejects a bare LF in the recipient", async () => {
    const res = await action({
      request: makeRequest({ to: "x@y.com\nBcc: attacker@evil.com" }),
    } as any);
    expect(res.status).toBe(400);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe("POST /api/email/send authorization", () => {
  it("rejects an authenticated non-Core member", async () => {
    // This route sends as the Hiring identity (applications@), so a plain
    // member reaching it means arbitrary mail from the admissions address.
    vi.mocked(isCore).mockResolvedValue(false);
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("checks authorization before spending rate-limit budget", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    for (let i = 0; i < 150; i++) {
      const res = await action({ request: makeRequest() } as any);
      expect(res.status).toBe(403);
    }
  });
});

describe("POST /api/email/send body sanitization", () => {
  it("strips script tags from caller-supplied HTML", async () => {
    const res = await action({
      request: makeRequest({ html: "<p>hi</p><script>alert(1)</script>" }),
    } as any);
    expect(res.status).toBe(200);
    expect(mockEnqueue.mock.calls[0][0].bodyHtml).toBe("<p>hi</p>");
  });

  it("neutralizes a javascript: href", async () => {
    await action({
      request: makeRequest({ html: '<a href="javascript:alert(1)">x</a>' }),
    } as any);
    const sent = mockEnqueue.mock.calls[0][0].bodyHtml as string;
    expect(sent).not.toContain("javascript:");
  });

  it("keeps ordinary formatting and links intact", async () => {
    await action({
      request: makeRequest({
        html: '<p><strong>Hi</strong> <a href="https://dali.dartmouth.edu">link</a></p>',
      }),
    } as any);
    const sent = mockEnqueue.mock.calls[0][0].bodyHtml as string;
    expect(sent).toContain("<strong>Hi</strong>");
    expect(sent).toContain('href="https://dali.dartmouth.edu"');
  });
});
