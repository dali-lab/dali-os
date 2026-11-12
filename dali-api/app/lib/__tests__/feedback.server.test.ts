import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuth = vi.fn();
const isNonMember = vi.fn();
const redirectPartnerToPortal = vi.fn();
const getUserRoles = vi.fn();

vi.mock("~/lib/auth", () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  isNonMember: (...a: unknown[]) => isNonMember(...a),
  redirectPartnerToPortal: (...a: unknown[]) => redirectPartnerToPortal(...a),
}));
vi.mock("~/lib/roles", () => ({ getUserRoles: (...a: unknown[]) => getUserRoles(...a) }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));

import { requireFeedbackViewer } from "../feedback.server";

const request = new Request("https://os.example/feedback");
const user = { sub: "u1", email: "ada@example.edu" };

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ ok: true, user });
  isNonMember.mockResolvedValue(false);
  redirectPartnerToPortal.mockResolvedValue(null);
  getUserRoles.mockResolvedValue({ isLabMember: true, isCore: false });
});

describe("requireFeedbackViewer", () => {
  it("lets a lab member in", async () => {
    expect(await requireFeedbackViewer(request)).toEqual({ user, core: false });
  });

  it("flags Core members", async () => {
    getUserRoles.mockResolvedValue({ isLabMember: false, isCore: true });
    expect(await requireFeedbackViewer(request)).toEqual({ user, core: true });
  });

  it("404s a signed-in user who is neither a lab member nor Core", async () => {
    getUserRoles.mockResolvedValue({ isLabMember: false, isCore: false });
    const thrown = await requireFeedbackViewer(request).catch((e) => e);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });
});
