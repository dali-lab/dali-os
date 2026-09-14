import type { Route } from "./+types/api.wallet.apple.v1.pass";
import { walletAppleConfigured, buildAppleWalletPass } from "~/lib/wallet-apple.server";
import { verifyWalletAuthToken } from "~/lib/wallet-token";
import { prisma } from "~/lib/db";

// PassKit web-service "get latest pass" endpoint.
//
// Called by the device after it receives an APNs push (via the serial-list
// endpoint confirming this pass needs an update). We verify the auth token,
// honour If-Modified-Since to avoid unnecessary re-sends, then build and
// return the fresh .pkpass archive.
//
// serialNumber IS the member's User.id (set as PKPass.serialNumber when built).
//
// Spec: https://developer.apple.com/documentation/walletpasses/adding_a_web_service_to_update_passes

function authToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = header.match(/^ApplePass\s+(.+)$/);
  return match ? match[1] : null;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { passTypeIdentifier, serialNumber } = params;

  if (passTypeIdentifier !== process.env.APPLE_PASS_TYPE_ID) {
    return new Response(null, { status: 404 });
  }

  const token = authToken(request);
  if (!token || !verifyWalletAuthToken(serialNumber, token)) {
    return new Response(null, { status: 401 });
  }

  if (!walletAppleConfigured()) {
    return new Response("Wallet passes aren't configured", { status: 503 });
  }

  const user = await prisma.user.findUnique({
    where: { id: serialNumber },
    select: { walletPassUpdatedAt: true },
  });
  if (!user) return new Response(null, { status: 404 });

  // Honour If-Modified-Since: 304 when the device already has the current version.
  const ifModifiedSince = request.headers.get("If-Modified-Since");
  if (ifModifiedSince && user.walletPassUpdatedAt) {
    const clientDate = new Date(ifModifiedSince);
    if (!isNaN(clientDate.getTime()) && clientDate >= user.walletPassUpdatedAt) {
      return new Response(null, { status: 304 });
    }
  }

  const pass = await buildAppleWalletPass(serialNumber);

  const headers: HeadersInit = {
    "Content-Type": "application/vnd.apple.pkpass",
  };
  if (user.walletPassUpdatedAt) {
    headers["Last-Modified"] = user.walletPassUpdatedAt.toUTCString();
  }

  return new Response(new Uint8Array(pass), { headers });
}
