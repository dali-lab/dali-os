import type { Route } from "./+types/api.wallet.google.save-url";
import { requireAuth } from "~/lib/auth";
import {
  walletGoogleConfigured,
  buildGoogleWalletSaveUrl,
} from "~/lib/wallet-google.server";

// GET /api/wallet/google/save-url
//
// Returns a { url } JSON response containing the Google Wallet save-JWT link
// for the authenticated member. The client opens this URL to add (or refresh)
// their DALI membership pass in Google Wallet.

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.user.type === "applicant")
    return Response.json({ error: "Forbidden" }, { status: 403 });

  if (!walletGoogleConfigured())
    return Response.json(
      { error: "Google Wallet isn't configured" },
      { status: 503 },
    );

  const origin = new URL(request.url).origin;
  const url = await buildGoogleWalletSaveUrl(auth.user.sub, origin);
  return Response.json({ url });
}
