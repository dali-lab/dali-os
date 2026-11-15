import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(),
  isPartnerAccount: vi.fn(),
  getUserRoles: vi.fn(),
}));

vi.mock("~/lib/auth", async () => {
  const { redirect } = await import("react-router");
  return {
    requireAuth: mocks.requireAuth,
    isNonMember: mocks.isNonMember,
    redirectPartnerToPortal: async (auth: unknown) =>
      (await mocks.isPartnerAccount(auth)) ? redirect("/partner") : null,
  };
});
vi.mock("~/lib/roles", () => ({ getUserRoles: mocks.getUserRoles }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/db.server", () => ({ prisma: {} }));

import { loader as profileLoader } from "../profile";
import { loader as notificationsLoader } from "../notifications";
import { loader as templatesLoader } from "../drive.templates";
import { loader as fileLoader } from "../documents.file.$fileId";
import { loadSettingsPageData } from "~/lib/settings-page.server";

const request = new Request("http://localhost/x");
const call = (fn: (a: never) => unknown) => () =>
  Promise.resolve(fn({ request, params: { fileId: "f1" }, context: {} } as never));

const gates: [string, () => Promise<unknown>][] = [
  ["profile", call(profileLoader as never)],
  ["notifications", call(notificationsLoader as never)],
  ["drive templates", call(templatesLoader as never)],
  ["documents file", call(fileLoader as never)],
  ["settings", () => loadSettingsPageData(request)],
];

async function outcome(run: () => Promise<unknown>): Promise<string | null> {
  try {
    const res = await run();
    return res instanceof Response ? res.headers.get("Location") : null;
  } catch (e) {
    return e instanceof Response ? e.headers.get("Location") : "error";
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
  mocks.isNonMember.mockResolvedValue(false);
  mocks.isPartnerAccount.mockResolvedValue(false);
  mocks.getUserRoles.mockResolvedValue({ isLabMember: true });
});

describe.each(gates)("%s page gate", (_name, run) => {
  it("sends a signed-out visitor to login", async () => {
    mocks.requireAuth.mockResolvedValue({ ok: false });
    expect(await outcome(run)).toContain("/login");
  });

  it("sends a partner to /partner", async () => {
    mocks.isPartnerAccount.mockResolvedValue(true);
    mocks.isNonMember.mockResolvedValue(true);
    expect(await outcome(run)).toBe("/partner");
  });

  it("sends a non-member to /portal", async () => {
    mocks.isNonMember.mockResolvedValue(true);
    expect(await outcome(run)).toBe("/portal");
  });

  it("lets a member past the gate", async () => {
    expect(await outcome(run)).not.toMatch(/^\/(portal|partner|login)/);
    expect(mocks.getUserRoles).toHaveBeenCalledWith("u1", request);
  });
});

describe("profile loader", () => {
  it("sends a member to their member page", async () => {
    expect(await outcome(call(profileLoader as never))).toBe("/members/u1");
  });
});
