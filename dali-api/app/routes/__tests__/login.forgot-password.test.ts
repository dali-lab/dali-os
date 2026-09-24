import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRequestPasswordReset = vi.hoisted(() => vi.fn());
const mockIsFeatureEnabledForEveryone = vi.hoisted(() => vi.fn());

vi.mock("~/lib/betterauth.server", () => ({
  auth: { api: { requestPasswordReset: mockRequestPasswordReset } },
}));
vi.mock("~/lib/feature-flags.server", () => ({
  isFeatureEnabledForEveryone: mockIsFeatureEnabledForEveryone,
}));

import { loader, action } from "~/routes/login.forgot-password";

function makePost(body: Record<string, string>) {
  return new Request("http://localhost/login/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

function getReq() {
  return new Request("http://localhost/login/forgot-password");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
  mockRequestPasswordReset.mockResolvedValue(undefined);
});

describe("/login/forgot-password", () => {
  it("flag-OFF loader redirects to /login", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(false);
    const res = (await loader({ request: getReq() } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("flag-ON loader renders", async () => {
    const result = await loader({ request: getReq() } as any);
    expect(result).toEqual({});
  });

  it("requests a reset and returns a neutral sent response", async () => {
    const result = await action({
      request: makePost({ email: "ada@dartmouth.edu" }),
    } as any);
    expect(mockRequestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          email: "ada@dartmouth.edu",
          redirectTo: "/login/reset-password",
        }),
      }),
    );
    expect(result).toMatchObject({ sent: true, email: "ada@dartmouth.edu" });
  });

  it("swallows errors (anti-enumeration)", async () => {
    mockRequestPasswordReset.mockRejectedValue(new Error("boom"));
    const result = await action({
      request: makePost({ email: "nobody@example.com" }),
    } as any);
    expect(result).toMatchObject({ sent: true });
  });

  it("flag-OFF action redirects to /login", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(false);
    const res = (await action({ request: makePost({ email: "x@y.com" }) } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });
});
