import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(),
  walletGoogleConfigured: vi.fn(),
  buildGoogleWalletSaveUrl: vi.fn(),
  update: vi.fn(),
}));

vi.mock("~/lib/auth", () => ({ requireAuth: m.requireAuth, isNonMember: m.isNonMember }));
vi.mock("~/lib/db.server", () => ({ prisma: { user: { update: m.update } } }));
vi.mock("~/wallet/lib/wallet-google.server", () => ({
  walletGoogleConfigured: m.walletGoogleConfigured,
  buildGoogleWalletSaveUrl: m.buildGoogleWalletSaveUrl,
}));

import { loader } from "../api.wallet.google.save-url";

const run = () => loader({ request: new Request("https://os.example/api/wallet/google/save-url") } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  m.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
  m.isNonMember.mockResolvedValue(false);
  m.walletGoogleConfigured.mockReturnValue(true);
  m.buildGoogleWalletSaveUrl.mockResolvedValue("https://pay.google.com/gp/v/save/jwt");
  m.update.mockResolvedValue({});
});

describe("GET /api/wallet/google/save-url", () => {
  it("returns the save link and records that the member asked for it", async () => {
    const res = await run();
    expect(await res.json()).toEqual({ url: "https://pay.google.com/gp/v/save/jwt" });
    expect(m.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { googleWalletSavedAt: expect.any(Date) } });
  });

  it("records nothing when Google Wallet isn't configured", async () => {
    m.walletGoogleConfigured.mockReturnValue(false);
    expect((await run()).status).toBe(503);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("records nothing for a signed-out visitor or a non-member", async () => {
    m.requireAuth.mockResolvedValue({ ok: false });
    expect((await run()).status).toBe(401);
    m.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
    m.isNonMember.mockResolvedValue(true);
    expect((await run()).status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });
});
