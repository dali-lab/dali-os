import type { Route } from "./+types/api.wallet.apple.pass";
import { requireAuth } from "~/lib/auth";
import { walletAppleConfigured, buildAppleWalletPass } from "~/lib/wallet-apple.server";

// Resource route: member downloads their own Apple Wallet membership pass.
// Returns a signed .pkpass archive. Gated on walletAppleConfigured() so staging
// environments without the Apple certs return a clean 503 instead of a 500.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });

  if (auth.user.type === "applicant") return new Response("Forbidden", { status: 403 });

  if (!walletAppleConfigured()) {
    return new Response("Wallet passes aren't configured", { status: 503 });
  }

  const pass = await buildAppleWalletPass(auth.user.sub);

  return new Response(new Uint8Array(pass), {
    headers: {
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": 'attachment; filename="DALI.pkpass"',
    },
  });
}
