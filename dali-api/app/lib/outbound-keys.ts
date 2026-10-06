// Dedup-key construction for the outbox. A leaf module (no prisma, no imports
// from outbound.server) so callers and tests can use it without the server
// module graph.
//
// Why this exists rather than interpolating a key inline: a dedupKey outlives
// the message it guards. The retention janitor strips bodyHtml/bodyText at 24h
// but never touches dedupKey, and Sent rows survive until retentionMonths
// (default 6). So a key that embeds a credential — a one-time URL, an OTP, a
// token — keeps that credential readable in Postgres, in every Neon branch cut
// from it, and in every backup, long after the email itself is unusable.
//
// Sends that need "always deliver, never coalesce" want freshness, not the
// secret. freshKey() gives freshness from a nonce.

import { randomUUID } from "node:crypto";

// A key that is unique per call, so the (channel, dedupKey) claim never
// collides and the send always goes out. Use for credential-bearing mail
// (sign-in links, OTPs) and anything else where a resend must deliver.
//
// `scope` is for human legibility in Admin → Communications only — it is not
// what makes the key unique, so it must never carry a secret either.
export function freshKey(prefix: string, scope: string): string {
  return `${prefix}:${scope}:${randomUUID()}`;
}
