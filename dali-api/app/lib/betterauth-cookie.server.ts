// BetterAuth session cookie serialization for use outside a BetterAuth endpoint
// context (specifically: the desktop handoff route, which must plant the webview
// session cookie after minting it via mintBetterAuthSession).
//
// BIG WARNING: This reproduces BetterAuth's signed-cookie write in a place that
// has no public API for it. The mechanism is correct as of better-auth@1.7.x +
// better-call@0.x, but is fragile:
//
//   - Cookie name: derived from auth.$context → authCookies.sessionToken.name
//     (shaped by cookiePrefix + "session_token", with optional Secure- prefix).
//   - Cookie attributes: derived from auth.$context → authCookies.sessionToken.attributes
//     (httpOnly, secure, sameSite, path, maxAge).
//   - Signature format: better-call serializeSignedCookie → signCookieValue
//     (HMAC-SHA-256, standard base64, `${value}.${sig}` encodeURIComponent'd).
//   - Secret: auth.$context → secret (the resolved BETTER_AUTH_SECRET).
//
// IF BetterAuth or better-call changes any of these (cookie name strategy,
// signing algorithm, attribute names), this helper MUST be updated to match.
//
// INTEGRATION TEST REQUIREMENT: The cookie round-trip (does auth.api.getSession
// accept a cookie produced by this function?) MUST be verified in an integration
// test against a real BetterAuth instance before the betterauth flag is enabled.
// The unit tests in auth.pair.betterauth.test.ts verify shape, not round-trip.

import { serializeSignedCookie } from "better-call";
import { auth } from "~/lib/betterauth.server";

/**
 * Append a BetterAuth session token cookie to `headers` (via Set-Cookie).
 *
 * Mimics what BetterAuth's internal `setSignedCookie` does at the end of a
 * successful sign-in, but called from outside a BetterAuth request context.
 * Uses the same cookie name, attributes, and HMAC-SHA-256 signature the real
 * BetterAuth endpoints produce so that `auth.api.getSession` can verify it.
 *
 * @param headers  Response headers to append the Set-Cookie to.
 * @param token    The raw session token returned by mintBetterAuthSession.
 */
export async function appendBetterAuthSessionCookie(
  headers: Headers,
  token: string,
): Promise<void> {
  const ctx = await auth.$context;
  const { name, attributes } = ctx.authCookies.sessionToken;
  const { secret } = ctx;

  const cookieStr = await serializeSignedCookie(name, token, secret, attributes);
  headers.append("Set-Cookie", cookieStr);
}
