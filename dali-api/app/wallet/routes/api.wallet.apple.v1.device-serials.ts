import type { Route } from "./+types/api.wallet.apple.v1.device-serials";
import { prisma } from "~/lib/db";

// PassKit web-service "list updated passes for device" endpoint.
//
// Apple calls this after receiving an APNs push to find out which of the
// device's passes actually need re-fetching. No Authorization header is sent
// on this call per Apple's spec — the device identity is implicit in the path.
//
// The `passesUpdatedSince` query param (when present) is the `lastUpdated` tag
// we returned from a prior call. We store epoch-millisecond strings as the tag
// so the comparison is a simple integer comparison.
//
// Spec: https://developer.apple.com/documentation/walletpasses/adding_a_web_service_to_update_passes

export async function loader({ request, params }: Route.LoaderArgs) {
  const { deviceLibraryIdentifier, passTypeIdentifier } = params;

  if (passTypeIdentifier !== process.env.APPLE_PASS_TYPE_ID) {
    return new Response(null, { status: 404 });
  }

  const url = new URL(request.url);
  const passesUpdatedSince = url.searchParams.get("passesUpdatedSince");
  const sinceMs = passesUpdatedSince ? Number(passesUpdatedSince) : null;

  // Find all serial numbers registered for this device.
  const registrations = await prisma.walletPassRegistration.findMany({
    where: { deviceLibraryIdentifier },
    select: { serialNumber: true },
  });

  if (registrations.length === 0) {
    return new Response(null, { status: 204 });
  }

  const userIds = registrations.map((r) => r.serialNumber);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, walletPassUpdatedAt: true },
  });

  // A pass qualifies if it has an update timestamp AND it's newer than the
  // last-seen tag (or the device hasn't checked before).
  const qualified = users.filter(
    (u) =>
      u.walletPassUpdatedAt !== null &&
      (sinceMs === null || u.walletPassUpdatedAt.getTime() > sinceMs),
  );

  if (qualified.length === 0) {
    return new Response(null, { status: 204 });
  }

  const maxUpdatedAt = qualified.reduce<Date>(
    (max, u) => (u.walletPassUpdatedAt! > max ? u.walletPassUpdatedAt! : max),
    qualified[0].walletPassUpdatedAt!,
  );

  return Response.json({
    serialNumbers: qualified.map((u) => u.id),
    lastUpdated: String(maxUpdatedAt.getTime()),
  });
}
