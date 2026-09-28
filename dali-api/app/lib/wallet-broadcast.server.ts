// Restyle broadcast: push the current pass design to passes ALREADY saved on
// members' phones, across both platforms. Shared by the manual script
// (scripts/wallet-broadcast-restyle.ts) and the self-gating wallet-pass-release
// job, so both roll out a design change the same way.

import { getApiBaseUrl } from "~/lib/app-env";
import {
  walletGoogleConfigured,
  patchAllGoogleWalletObjects,
} from "~/lib/wallet-google.server";
import { walletAppleConfigured } from "~/lib/wallet-apple.server";
import { pushAllWalletPassUpdates } from "~/lib/wallet-apns.server";

export type WalletBroadcastResult = {
  google: { configured: boolean; total: number; patched: number; skipped: number; failed: number };
  apple: { configured: boolean; users: number };
};

/**
 * PATCH every existing Google object in place and re-push every registered Apple
 * device so installed passes pick up the current design. Per-platform work is
 * skipped when that platform isn't configured. `commit=false` counts without
 * writing (dry run). Idempotent — patching is a no-op when the design already
 * matches, so this is always safe to re-run.
 */
export async function runWalletRestyleBroadcast(
  commit: boolean,
  origin: string = getApiBaseUrl(),
): Promise<WalletBroadcastResult> {
  const google = walletGoogleConfigured()
    ? { configured: true, ...(await patchAllGoogleWalletObjects(origin, commit)) }
    : { configured: false, total: 0, patched: 0, skipped: 0, failed: 0 };

  const apple = walletAppleConfigured()
    ? { configured: true, ...(await pushAllWalletPassUpdates(commit)) }
    : { configured: false, users: 0 };

  return { google, apple };
}
