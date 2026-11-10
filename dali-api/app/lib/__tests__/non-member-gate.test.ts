import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isDomainLead: vi.fn(),
  isProjectMember: vi.fn(),
  isLabMember: vi.fn(),
}));

import { isLabMember } from "~/lib/roles";
import {
  isNonMember,
  redirectNonMemberToPortal,
  forbidNonMember,
  type AuthSuccess,
  type AuthType,
} from "~/lib/auth";

function auth(type: AuthType, sub = "u1"): AuthSuccess {
  return { ok: true, user: { sub, email: "u@example.com", type }, sessionId: "s1" };
}

const request = () => new Request("https://dali.test/members");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isNonMember", () => {
  it("keys on the DALIMember row, not the auth type", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    expect(await isNonMember(auth("dartmouth"), request())).toBe(false);
    expect(await isNonMember(auth("partner"), request())).toBe(false);
    expect(await isNonMember(auth("member"), request())).toBe(false);

    vi.mocked(isLabMember).mockResolvedValue(false);
    expect(await isNonMember(auth("member"), request())).toBe(true);
    expect(await isNonMember(auth("dartmouth"), request())).toBe(true);
  });

  it("passes the request through so the lookup is memoized per navigation", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    const req = request();
    await isNonMember(auth("member", "u9"), req);
    expect(isLabMember).toHaveBeenCalledWith("u9", req);
  });
});

describe("redirectNonMemberToPortal", () => {
  it("sends a non-member to /portal", async () => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    const res = await redirectNonMemberToPortal(auth("dartmouth"), request());
    expect(res?.status).toBe(302);
    expect(res?.headers.get("Location")).toBe("/portal");
  });

  it("returns null for a lab member regardless of type", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    expect(await redirectNonMemberToPortal(auth("dartmouth"), request())).toBeNull();
    expect(await redirectNonMemberToPortal(auth("member"), request())).toBeNull();
  });
});

describe("forbidNonMember", () => {
  it("returns a 403 for a non-member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    const res = await forbidNonMember(auth("partner"), request());
    expect(res?.status).toBe(403);
  });

  it("returns null for a lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    expect(await forbidNonMember(auth("partner"), request())).toBeNull();
  });
});
