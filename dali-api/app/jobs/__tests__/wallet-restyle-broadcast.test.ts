import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/wallet-broadcast.server", () => ({ runWalletRestyleBroadcast: vi.fn() }));
vi.mock("~/lib/wallet-google.server", () => ({ walletGoogleConfigured: vi.fn() }));
vi.mock("~/lib/wallet-apple.server", () => ({ walletAppleConfigured: vi.fn() }));

import { runWalletRestyleBroadcastJob } from "~/jobs/wallet-restyle-broadcast.server";
import { runWalletRestyleBroadcast } from "~/lib/wallet-broadcast.server";
import { walletGoogleConfigured } from "~/lib/wallet-google.server";
import { walletAppleConfigured } from "~/lib/wallet-apple.server";

const broadcast = runWalletRestyleBroadcast as unknown as ReturnType<typeof vi.fn>;
const gConf = walletGoogleConfigured as unknown as ReturnType<typeof vi.fn>;
const aConf = walletAppleConfigured as unknown as ReturnType<typeof vi.fn>;

const ctx = { now: new Date("2026-09-28T00:00:00Z"), lastSuccessAt: null, settings: {} };

beforeEach(() => {
  vi.clearAllMocks();
  gConf.mockReturnValue(true);
  aConf.mockReturnValue(true);
});

describe("runWalletRestyleBroadcastJob", () => {
  it("no-ops when neither platform is configured", async () => {
    gConf.mockReturnValue(false);
    aConf.mockReturnValue(false);
    const r = await runWalletRestyleBroadcastJob(ctx as never);
    expect(r.note).toMatch(/not configured/);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("runs the broadcast and reports counts", async () => {
    broadcast.mockResolvedValue({
      google: { configured: true, total: 5, patched: 4, skipped: 0, failed: 1 },
      apple: { configured: true, users: 3 },
    });
    const r = await runWalletRestyleBroadcastJob(ctx as never);
    expect(broadcast).toHaveBeenCalledWith(true);
    expect(r.items).toBe(7);
    expect(r.note).toMatch(/google 4\/5 patched \(1 failed\), apple 3 re-pushed/);
  });
});
