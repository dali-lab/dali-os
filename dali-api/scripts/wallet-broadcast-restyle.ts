/**
 * Restyle release: push the current wallet-pass design to passes ALREADY saved on
 * members' phones, on both platforms.
 *
 *  - Google: PATCH every existing Generic object in place. A save-JWT never
 *    updates an object Google has already stored, so re-tapping "Add to Google
 *    Wallet" is a no-op; the REST patch is the only way to restyle an installed
 *    Android pass. Google then pushes the refreshed object to the device.
 *  - Apple: re-push every registered device so it re-fetches the redesigned
 *    .pkpass from the PassKit web service.
 *
 * New saves/downloads always get the current design, so this is only needed once
 * per design change, to bring already-installed passes up to date.
 *
 * Idempotent; safe to re-run. Dry run by default.
 *
 * Usage:
 *   npx tsx scripts/wallet-broadcast-restyle.ts           # dry run
 *   npx tsx scripts/wallet-broadcast-restyle.ts --commit  # write + push
 *
 * Run it in the target environment (e.g. `fly ssh console` on the prod app) so it
 * uses that environment's wallet credentials, database, and API_BASE_URL — Google
 * fetches the pass images from that origin, and the patched barcodes must verify
 * against that environment's WALLET_PASS_SECRET.
 */

import { prisma } from "../app/lib/db";
import { getApiBaseUrl } from "../app/lib/app-env";
import {
  walletGoogleConfigured,
  patchAllGoogleWalletObjects,
} from "../app/lib/wallet-google.server";
import { walletAppleConfigured } from "../app/lib/wallet-apple.server";
import { pushAllWalletPassUpdates } from "../app/lib/wallet-apns.server";

async function main() {
  const commit = process.argv.includes("--commit");
  const origin = getApiBaseUrl();
  console.log(
    `Wallet restyle broadcast — origin ${origin}` +
      (commit ? "" : " (dry run — pass --commit to write)") +
      "\n",
  );

  // Google: patch existing objects in place.
  if (walletGoogleConfigured()) {
    const g = await patchAllGoogleWalletObjects(origin, commit);
    console.log(
      `Google: ${g.total} object(s) — ${g.patched} ${commit ? "patched" : "to patch"}, ` +
        `${g.skipped} skipped, ${g.failed} failed.`,
    );
  } else {
    console.log("Google: not configured — skipped.");
  }

  // Apple: re-push registered devices.
  if (walletAppleConfigured()) {
    const a = await pushAllWalletPassUpdates(commit);
    console.log(
      `Apple: ${a.users} member(s) with installed passes ${commit ? "re-pushed" : "to re-push"}.`,
    );
  } else {
    console.log("Apple: not configured — skipped.");
  }

  console.log(`\nDone.${commit ? "" : " (dry run — pass --commit to write)"}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
