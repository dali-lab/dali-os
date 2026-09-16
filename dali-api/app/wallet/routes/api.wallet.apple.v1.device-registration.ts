import type { Route } from "./+types/api.wallet.apple.v1.device-registration";
import { prisma } from "~/lib/db";
import { verifyWalletAuthToken } from "~/lib/wallet-token";

// PassKit web-service device registration endpoints.
//
// Apple calls POST when a user adds the pass to their device (or after a push
// triggers a re-fetch of updated passes), and DELETE when the pass is removed.
// Both carry `Authorization: ApplePass <token>` — we verify it before touching
// any data. The serialNumber path segment IS the member's User.id.
//
// Spec: https://developer.apple.com/documentation/walletpasses/adding_a_web_service_to_update_passes

function authToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = header.match(/^ApplePass\s+(.+)$/);
  return match ? match[1] : null;
}

export async function action({ request, params }: Route.ActionArgs) {
  const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = params;

  if (passTypeIdentifier !== process.env.APPLE_PASS_TYPE_ID) {
    return new Response(null, { status: 404 });
  }

  const token = authToken(request);
  if (!token || !verifyWalletAuthToken(serialNumber, token)) {
    return new Response(null, { status: 401 });
  }

  if (request.method === "POST") {
    let body: { pushToken?: string };
    try {
      body = await request.json();
    } catch {
      return new Response(null, { status: 400 });
    }

    const { pushToken } = body;
    if (!pushToken) return new Response(null, { status: 400 });

    // Detect whether the row already exists to choose 200 vs 201.
    const existing = await prisma.walletPassRegistration.findUnique({
      where: {
        deviceLibraryIdentifier_serialNumber: { deviceLibraryIdentifier, serialNumber },
      },
    });

    await prisma.walletPassRegistration.upsert({
      where: {
        deviceLibraryIdentifier_serialNumber: { deviceLibraryIdentifier, serialNumber },
      },
      create: { deviceLibraryIdentifier, serialNumber, pushToken },
      update: { pushToken },
    });

    return new Response(null, { status: existing ? 200 : 201 });
  }

  if (request.method === "DELETE") {
    // deleteMany avoids a throw when the row is already absent.
    await prisma.walletPassRegistration.deleteMany({
      where: { deviceLibraryIdentifier, serialNumber },
    });
    return new Response(null, { status: 200 });
  }

  return new Response(null, { status: 405 });
}
