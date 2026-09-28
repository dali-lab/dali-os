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
import { runWalletRestyleBroadcast } from "../app/lib/wallet-broadcast.server";

async function main() {
  const commit = process.argv.includes("--commit");
  const origin = getApiBaseUrl();
  console.log(
    `Wallet restyle broadcast — origin ${origin}` +
      (commit ? "" : " (dry run — pass --commit to write)") +
      "\n",
  );

  const { google, apple } = await runWalletRestyleBroadcast(commit, origin);

  console.log(
    google.configured
      ? `Google: ${google.total} object(s) — ${google.patched} ${commit ? "patched" : "to patch"}, ` +
          `${google.skipped} skipped, ${google.failed} failed.`
      : "Google: not configured — skipped.",
  );
  console.log(
    apple.configured
      ? `Apple: ${apple.users} member(s) with installed passes ${commit ? "re-pushed" : "to re-push"}.`
      : "Apple: not configured — skipped.",
  );

  console.log(`\nDone.${commit ? "" : " (dry run — pass --commit to write)"}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
