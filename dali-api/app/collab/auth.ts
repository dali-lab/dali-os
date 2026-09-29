import { lookupSession, rollSession } from "~/lib/session";

// Hocuspocus onAuthenticate handler — verifies the credential passed through the
// WS handshake. Returns the legacy `{ sub }` shape so the rest of collab/server.ts
// (which reads `user.sub` for authz and connection accounting) continues to work
// without per-call edits.
//
// Two auth backends coexist across the BetterAuth cutover, matching what
// getCollabToken (~/lib/collab-token.server) minted:
//   - Legacy session: the raw __dali_sid credential, resolved via lookupSession.
//   - BetterAuth session: a bearer token, validated via auth.api.getSession.
// See SESSION_AUTH_PLAN.md § Phase 5.5.
export async function verifyCollabToken(rawToken: string): Promise<{ sub: string }> {
  const session = await lookupSession(rawToken);
  if (session) {
    if (session.revokedAt) throw new Error("Session revoked");
    const now = new Date();
    if (session.expiresAt < now || session.absoluteExpiresAt < now) {
      throw new Error("Session expired");
    }
    // Every successful collab handshake counts as activity for rolling expiry.
    rollSession(session).catch(() => {});
    return { sub: session.userId };
  }

  // Legacy miss → a BetterAuth bearer token (the norm once the flag is on).
  // Lazy-imported so BetterAuth stays out of the module graph on the legacy
  // path; wrapped so a fault there can't turn an invalid token into a 500.
  try {
    const { verifyBetterAuthBearerToken } = await import(
      "~/lib/betterauth-compat.server"
    );
    const sub = await verifyBetterAuthBearerToken(rawToken);
    if (sub) return { sub };
  } catch {
    // fall through to the invalid-session error below
  }
  throw new Error("Invalid session");
}
