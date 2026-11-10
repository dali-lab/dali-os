import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectNonMemberToPortal: vi.fn().mockResolvedValue(null),
  isNonMember: vi.fn().mockResolvedValue(false),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/partners/lib/referrals.server", () => ({
  hasPassedReferralQuiz: vi.fn(),
  recordReferralQuizPass: vi.fn(),
  createPartnerReferral: vi.fn(),
  requireReferralsEnabled: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { hasPassedReferralQuiz, requireReferralsEnabled } from "~/partners/lib/referrals.server";
import { loader as referLoader } from "~/partners/routes/refer";
import { loader as referNewLoader } from "~/partners/routes/refer.new";
import { loader as referDoneLoader } from "~/partners/routes/refer.done";

const LOADERS = [
  ["/refer", referLoader],
  ["/refer/new", referNewLoader],
  ["/refer/done", referDoneLoader],
] as const;

function call(path: string, loader: (args: any) => unknown) {
  return loader({ request: new Request(`http://localhost${path}?tier=Cold`), params: {}, context: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as any).mockResolvedValue({ ok: true, user: { sub: "u1" }, sessionId: "s1" });
  (hasPassedReferralQuiz as any).mockResolvedValue(true);
  (requireReferralsEnabled as any).mockResolvedValue(undefined);
});

describe("refer page loaders", () => {
  it.each(LOADERS)("%s 404s while the refer-a-partner flag is off", async (path, loader) => {
    (requireReferralsEnabled as any).mockRejectedValue(new Response("Not found", { status: 404 }));
    await expect(call(path, loader)).rejects.toMatchObject({ status: 404 });
    expect(requireReferralsEnabled).toHaveBeenCalledWith("u1", expect.any(Request));
    expect(hasPassedReferralQuiz).not.toHaveBeenCalled();
  });

  it.each(LOADERS)("%s loads while the flag is on", async (path, loader) => {
    await expect(call(path, loader)).resolves.toBeDefined();
  });
});
