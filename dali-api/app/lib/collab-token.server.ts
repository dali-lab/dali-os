import { parseSessionCookie } from "~/lib/cookies";

// The credential a route loader hands to the collab client, which forwards it to
// Hocuspocus over the WS handshake. Two auth backends coexist during (and after)
// the BetterAuth cutover:
//   - Legacy session: the raw __dali_sid id, validated server-side via
//     lookupSession in verifyCollabToken.
//   - BetterAuth session: the live session's bearer token, validated via
//     auth.api.getSession (the same bearer path the MCP provider uses).
// A legacy cookie wins when present so nothing changes for a not-yet-migrated
// session; otherwise we read the BetterAuth session token. Once the legacy
// Session table is dropped at cleanup, only the BetterAuth branch matches.
//
// betterauth-compat.server is lazy-imported so its module graph (BetterAuth +
// the auth instance) loads only when a request has no legacy cookie — keeping it
// out of unit tests that exercise the legacy path.
export async function getCollabToken(request: Request): Promise<string | null> {
  const legacy = parseSessionCookie(request);
  if (legacy) return legacy;
  try {
    const { getBetterAuthCollabToken } = await import("~/lib/betterauth-compat.server");
    return await getBetterAuthCollabToken(request);
  } catch {
    // A BetterAuth fault must degrade to "no collab token" (editor becomes
    // read-only), never 500 the page loader.
    return null;
  }
}
