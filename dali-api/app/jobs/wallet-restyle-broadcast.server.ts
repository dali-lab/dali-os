// On-demand rollout of a wallet-pass design change to passes already on members'
// phones. Registered as a disabled-by-default job so it NEVER runs on a tick — it
// exists only to be triggered from Admin → Jobs → "Run now" after a design change
// ships. New saves always get the current design; this restyles the installed ones
// (Google REST patch in place + Apple APNs re-push).
//
// Idempotent: patching an object that already matches the current design is a
// no-op, so re-running is always safe.

import type { JobContext, JobResult } from "~/jobs/registry";
import { runWalletRestyleBroadcast } from "~/lib/wallet-broadcast.server";
import { walletGoogleConfigured } from "~/lib/wallet-google.server";
import { walletAppleConfigured } from "~/lib/wallet-apple.server";

export async function runWalletRestyleBroadcastJob(_ctx: JobContext): Promise<JobResult> {
  if (!walletGoogleConfigured() && !walletAppleConfigured()) {
    return { note: "wallet not configured" };
  }

  const { google, apple } = await runWalletRestyleBroadcast(true);

  return {
    items: google.patched + apple.users,
    note:
      `google ${google.patched}/${google.total} patched (${google.failed} failed), ` +
      `apple ${apple.users} re-pushed`,
  };
}
