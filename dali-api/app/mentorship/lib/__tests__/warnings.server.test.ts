import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));

import { requireAuth, isNonMember } from "~/lib/auth";
import { isCore, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { requireWarningsAdmin, warningsEnabledFor } from "../warnings.server";

const request = new Request("http://localhost/mentorship/warnings");

async function thrown(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as Response;
  }
  return null;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(getUserRoles).mockResolvedValue({ isCore: true } as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("requireWarningsAdmin", () => {
  it("returns the user id for Core with the flag on", async () => {
    expect(await requireWarningsAdmin(request)).toBe("u1");
    expect(isFeatureEnabled).toHaveBeenCalledWith("mentorship-warnings", "u1", { isCore: true }, request);
  });

  it("sends a logged out visitor to login", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    expect((await thrown(requireWarningsAdmin(request)))?.status).toBe(302);
  });

  it("sends a non-member to the portal", async () => {
    vi.mocked(isNonMember).mockResolvedValue(true);
    const res = await thrown(requireWarningsAdmin(request));
    expect(res?.headers.get("Location")).toBe("/portal");
  });

  it("returns 404 when the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect((await thrown(requireWarningsAdmin(request)))?.status).toBe(404);
  });

  it("returns 403 for a member who isn't Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    expect((await thrown(requireWarningsAdmin(request)))?.status).toBe(403);
  });
});

describe("warningsEnabledFor", () => {
  it("is true for Core with the flag on", async () => {
    expect(await warningsEnabledFor("u1", request)).toBe(true);
  });

  it("is false when the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect(await warningsEnabledFor("u1", request)).toBe(false);
  });

  it("is false for someone who isn't Core, even with the flag on", async () => {
    vi.mocked(getUserRoles).mockResolvedValue({ isCore: false } as never);
    expect(await warningsEnabledFor("u1", request)).toBe(false);
  });
});
