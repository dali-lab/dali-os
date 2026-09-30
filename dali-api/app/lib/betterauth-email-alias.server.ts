// Canonicalizes the address on BetterAuth's passwordless endpoints.
//
// BetterAuth resolves a sign-in by the single `user.email` column — it has no
// multi-email concept in 1.7.5 (the closest plugin, `username`, is a 1:1
// alternate identifier on the user row). So an alias has to be mapped to the
// canonical address BEFORE the endpoint runs, or findUserByEmail misses and
// emailOTP's disableSignUp discards the code without sending anything.
//
// This lives in a BetterAuth hook rather than in the /login route action
// because the route is not the only caller. routes.ts mounts `api/auth/*` as a
// catch-all, so authClient, the desktop shell and MCP all reach these endpoints
// directly. Resolution in the action would leave every one of those on the
// original bug while /login looked fixed.

import { createAuthMiddleware } from "better-auth/api";
import { markEmailProven, resolveLoginIdentifier } from "~/lib/user-email.server";

// Every endpoint that takes an address in its body. Both halves need it: the
// send half so the code reaches a real mailbox, and the sign-in half so a
// client that submits the alias it was given (rather than the canonical address
// our /login action threads through) still resolves instead of failing as a
// bad code. /magic-link/verify is absent on purpose — it carries a token.
const CANONICALIZE_PATHS = new Set([
  "/email-otp/send-verification-otp",
  "/sign-in/magic-link",
  "/sign-in/email-otp",
]);

/** Endpoints that complete a sign-in, proving the address it was sent to. */
const CONSUME_PATHS = new Set(["/sign-in/email-otp"]);

export function isAliasSendPath(path: string | undefined): boolean {
  return path !== undefined && CANONICALIZE_PATHS.has(path);
}

export function isAliasConsumePath(path: string | undefined): boolean {
  return path !== undefined && CONSUME_PATHS.has(path);
}

// `ctx` is BetterAuth's endpoint hook context, typed loosely for the same
// reason betterauth-passkey-audit.server.ts does: the plugin context generics
// aren't exported and this only touches `path` and `body`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function canonicalizeEmailBody(ctx: any): Promise<void> {
  if (!isAliasSendPath(ctx?.path)) return;
  const typed = ctx?.body?.email;
  if (typeof typed !== "string" || typed.trim() === "") return;

  // Never throws: a resolution failure must degrade to the address as typed
  // rather than break sign-in for everyone.
  try {
    const canonical = await resolveLoginIdentifier(typed);
    if (canonical !== "") ctx.body.email = canonical;
  } catch (err) {
    console.error("[auth:alias] canonicalization failed, using typed address:", err);
  }
}

/**
 * After a successful code sign-in, record that the address the code was sent to
 * has a reachable mailbox.
 *
 * Deliberately marks the CANONICAL address, not whatever alias was typed. The
 * person proved they can read mail delivered to the address we sent to; that
 * says nothing about any other address they entered, even when both happen to
 * route to one inbox.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recordProvenEmail(ctx: any): Promise<void> {
  if (!isAliasConsumePath(ctx?.path)) return;
  const address = ctx?.body?.email;
  if (typeof address !== "string" || address.trim() === "") return;
  // Only on success — a wrong code leaves an APIError in `returned`.
  const returned = ctx?.context?.returned;
  if (!returned || returned instanceof Error) return;

  try {
    await markEmailProven(address);
  } catch (err) {
    console.error("[auth:alias] failed to record proven address:", err);
  }
}
