import { lookupSession, rollSession } from "~/lib/session";

// Hocuspocus onAuthenticate handler — verifies a raw session id passed
// through the WS handshake. Returns the legacy `{ sub }` shape so the
// rest of collab/server.ts (which reads `user.sub` for authz and connection
// accounting) continues to work without per-call edits.
//
// The handshake credential is the same string that travels in the
// __dali_sid cookie. See SESSION_AUTH_PLAN.md § Phase 5.5.
export async function verifyCollabToken(rawSessionId: string): Promise<{ sub: string }> {
  const session = await lookupSession(rawSessionId);
  if (!session) throw new Error("Invalid session");
  if (session.revokedAt) throw new Error("Session revoked");
  const now = new Date();
  if (session.expiresAt < now || session.absoluteExpiresAt < now) {
    throw new Error("Session expired");
  }
  // Every successful collab handshake counts as activity for rolling expiry.
  rollSession(session).catch(() => {});
  return { sub: session.userId };
}
