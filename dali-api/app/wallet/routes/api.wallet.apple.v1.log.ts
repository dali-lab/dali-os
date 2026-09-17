import type { Route } from "./+types/api.wallet.apple.v1.log";

// PassKit web-service diagnostic log endpoint.
//
// Apple POSTs an array of log strings when something goes wrong on the device
// side (e.g. a failed pass fetch). Capturing them is essential for debugging
// silent-update failures in production — they rarely surface any other way.
//
// No Authorization header is sent on this call per Apple's spec.
//
// Spec: https://developer.apple.com/documentation/walletpasses/adding_a_web_service_to_update_passes

export async function action({ request }: Route.ActionArgs) {
  let body: { logs?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 200 });
  }

  if (Array.isArray(body.logs) && body.logs.length > 0) {
    console.warn("[wallet-passkit] device logs:", body.logs);
  }

  return new Response(null, { status: 200 });
}
