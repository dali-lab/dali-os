import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/oauth");

import { revokeToken } from "~/lib/oauth";
import { loader } from "~/routes/logout";

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  return new Request("http://localhost/logout", { headers });
}

function getSetCookies(res: Response): string[] {
  return res.headers.getSetCookie?.() ?? [];
}

describe("GET /logout", () => {
  it("revokes the refresh token family when cookie is present", async () => {
    vi.mocked(revokeToken).mockResolvedValue(undefined);

    const res = await loader({
      request: makeRequest("__dali_rt=raw-rt-value"),
    } as any);

    expect(revokeToken).toHaveBeenCalledTimes(1);
    expect(revokeToken).toHaveBeenCalledWith("raw-rt-value");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");

    const cookies = getSetCookies(res);
    expect(cookies.some((c) => c.startsWith("__dali_at=") && c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("__dali_rt=") && c.includes("Max-Age=0"))).toBe(true);
  });

  it("skips revocation when no refresh-token cookie is present", async () => {
    const res = await loader({ request: makeRequest() } as any);

    expect(revokeToken).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");

    const cookies = getSetCookies(res);
    expect(cookies.some((c) => c.startsWith("__dali_at=") && c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("__dali_rt=") && c.includes("Max-Age=0"))).toBe(true);
  });

  it("still completes logout when revokeToken throws", async () => {
    vi.mocked(revokeToken).mockRejectedValue(new Error("db down"));

    const res = await loader({
      request: makeRequest("__dali_rt=stale-token"),
    } as any);

    expect(revokeToken).toHaveBeenCalledWith("stale-token");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");

    const cookies = getSetCookies(res);
    expect(cookies.some((c) => c.startsWith("__dali_at=") && c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("__dali_rt=") && c.includes("Max-Age=0"))).toBe(true);
  });
});
