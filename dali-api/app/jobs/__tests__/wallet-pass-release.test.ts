import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { walletPassReleaseLog: { findUnique: vi.fn(), create: vi.fn() } },
}));
vi.mock("~/lib/wallet-broadcast.server", () => ({ runWalletRestyleBroadcast: vi.fn() }));
vi.mock("~/lib/wallet-google.server", () => ({ walletGoogleConfigured: vi.fn() }));
vi.mock("~/lib/wallet-apple.server", () => ({ walletAppleConfigured: vi.fn() }));

import { runWalletPassRelease } from "~/jobs/wallet-pass-release.server";
import { prisma } from "~/lib/db";
import { runWalletRestyleBroadcast } from "~/lib/wallet-broadcast.server";
import { walletGoogleConfigured } from "~/lib/wallet-google.server";
import { walletAppleConfigured } from "~/lib/wallet-apple.server";

const findUnique = prisma.walletPassReleaseLog.findUnique as unknown as ReturnType<typeof vi.fn>;
const create = prisma.walletPassReleaseLog.create as unknown as ReturnType<typeof vi.fn>;
const broadcast = runWalletRestyleBroadcast as unknown as ReturnType<typeof vi.fn>;
const gConf = walletGoogleConfigured as unknown as ReturnType<typeof vi.fn>;
const aConf = walletAppleConfigured as unknown as ReturnType<typeof vi.fn>;

const ctx = { now: new Date("2026-09-28T00:00:00Z"), lastSuccessAt: null, settings: {} };

beforeEach(() => {
  vi.clearAllMocks();
  gConf.mockReturnValue(true);
  aConf.mockReturnValue(true);
});

describe("runWalletPassRelease", () => {
  it("no-ops without recording when neither platform is configured", async () => {
    gConf.mockReturnValue(false);
    aConf.mockReturnValue(false);
    const r = await runWalletPassRelease(ctx as never);
    expect(r.note).toMatch(/not configured/);
    expect(broadcast).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("no-ops when the current version was already released", async () => {
    findUnique.mockResolvedValue({ version: "1" });
    const r = await runWalletPassRelease(ctx as never);
    expect(r.note).toMatch(/already released/);
    expect(broadcast).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("runs the broadcast and records the version on a new version", async () => {
    findUnique.mockResolvedValue(null);
    broadcast.mockResolvedValue({
      google: { configured: true, total: 5, patched: 4, skipped: 0, failed: 1 },
      apple: { configured: true, users: 3 },
    });
    const r = await runWalletPassRelease(ctx as never);
    expect(broadcast).toHaveBeenCalledWith(true);
    expect(create).toHaveBeenCalledWith({
      data: { version: "1", googlePatched: 4, googleFailed: 1, applePushed: 3 },
    });
    expect(r.items).toBe(7);
    expect(r.note).toMatch(/released v1/);
  });
});
