// Auto-releases a wallet-pass design change to passes already on members' phones.
//
// New saves always get the current design; installed passes don't (a Google
// save-JWT can't update an existing object, and Apple only re-fetches on an APNs
// push). So when WALLET_PASS_DESIGN_VERSION is bumped and deployed, this job — on
// its next tick after the deploy — sees a version with no WalletPassReleaseLog row,
// runs the restyle broadcast once, and records the version so it never re-runs for
// it. The version row is the cross-machine claim (the job lease serializes the
// handler; the PK makes the release idempotent even if a run is retried).

import type { JobContext, JobResult } from "~/jobs/registry";
import { prisma } from "~/lib/db";
import { WALLET_PASS_DESIGN_VERSION } from "~/lib/wallet-pass-version";
import { runWalletRestyleBroadcast } from "~/lib/wallet-broadcast.server";
import { walletGoogleConfigured } from "~/lib/wallet-google.server";
import { walletAppleConfigured } from "~/lib/wallet-apple.server";

export async function runWalletPassRelease(_ctx: JobContext): Promise<JobResult> {
  // Nothing to release until at least one platform is configured. Return without
  // recording so the first real release still fires once credentials land.
  if (!walletGoogleConfigured() && !walletAppleConfigured()) {
    return { note: "wallet not configured" };
  }

  const version = WALLET_PASS_DESIGN_VERSION;
  const already = await prisma.walletPassReleaseLog.findUnique({ where: { version } });
  if (already) return { note: `v${version} already released` };

  const { google, apple } = await runWalletRestyleBroadcast(true);

  // Record the release even when some objects failed: per-object failures
  // (deleted member, transient error) are logged and mostly permanent, and the
  // broadcast is idempotent, so a manual re-run of the script is always safe.
  await prisma.walletPassReleaseLog.create({
    data: {
      version,
      googlePatched: google.patched,
      googleFailed: google.failed,
      applePushed: apple.users,
    },
  });

  return {
    items: google.patched + apple.users,
    note:
      `released v${version}: google ${google.patched}/${google.total} patched ` +
      `(${google.failed} failed), apple ${apple.users} re-pushed`,
  };
}
