// BetterAuth server-side session minting.
//
// INTERNAL ADAPTER NOTE: This module calls `ctx.internalAdapter.createSession`
// which is NOT part of BetterAuth's stable public API. The function signature
// as of better-auth@1.7.x is:
//
//   createSession(
//     userId:          string,
//     dontRememberMe?: boolean,
//     override?:       Partial<session> & { [extra]: unknown },
//     overrideAll?:    boolean,
//     storageOptions?: object,
//   )
//
// How data is composed inside createSession (from dist/db/internal-adapter.mjs):
//   1. `ipAddress` / `userAgent` from request headers (if in an auth endpoint ctx)
//   2. `...rest`   — override object (minus `id`) spread over step 1
//   3. `expiresAt` — auto-computed from dontRememberMe / session.expiresIn config
//   4. `userId`, `token`, `createdAt`, `updatedAt` — always auto-generated
//   5. `...defaultAdditionalFields` — fields declared with a defaultValue
//   6. If `overrideAll === true`: `...rest` spread again, winning over steps 3-5
//
// Consequence for this helper:
//   - `grantId` lives in `override` (step 2). No standard field overwrites it in
//     steps 3-5, so `overrideAll` is NOT needed for grantId alone.
//   - Custom `expiresAt` MUST use `overrideAll: true` so it lands after step 3.
//   - `ipAddress` / `userAgent` passed via override WIN over header derivation.
//
// If BetterAuth releases a stable `createServerSession` API, migrate here first.

import { auth } from "~/lib/betterauth.server";

export interface MintBetterAuthSessionArgs {
  userId: string;
  /** Set for MCP-issued sessions. Null/undefined for normal browser sessions. */
  grantId?: string;
  /** Custom TTL in seconds. Defaults to the configured session.expiresIn (30d). */
  expiresInSec?: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface MintBetterAuthSessionResult {
  /** Raw bearer token (un-hashed). Return as `access_token` to the MCP client. */
  token: string;
  expiresAt: Date;
  /** The created session's `id` (cuid). Store in DevicePairing.desktopSessionId as the audit link. */
  sessionId: string;
}

export async function mintBetterAuthSession(
  args: MintBetterAuthSessionArgs,
): Promise<MintBetterAuthSessionResult> {
  const ctx = await auth.$context;

  // Build override fields. ipAddress and userAgent go here too — when called
  // outside a BetterAuth request context (i.e. from our OAuth token route),
  // the adapter has no request headers to derive them from, so pass them
  // explicitly. grantId is an additionalField declared in betterauth.server.ts.
  const override: Record<string, unknown> = {
    ...(args.grantId !== undefined ? { grantId: args.grantId } : {}),
    ...(args.ipAddress !== undefined ? { ipAddress: args.ipAddress } : {}),
    ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
    ...(args.expiresInSec !== undefined
      ? { expiresAt: new Date(Date.now() + args.expiresInSec * 1000) }
      : {}),
  };

  // overrideAll = true only when a custom expiresAt is present (must win over
  // the auto-computed value). False otherwise — token/userId stay auto-generated.
  const overrideAll = args.expiresInSec !== undefined;

  const session = await ctx.internalAdapter.createSession(
    args.userId,
    /* dontRememberMe */ false, // use configured expiresIn (30d) unless overrideAll
    override,
    overrideAll,
  );

  if (!session) {
    throw new Error("[betterauth-session] createSession returned null — check database connectivity and schema");
  }

  return {
    token: session.token as string,
    expiresAt: new Date(session.expiresAt as string | Date),
    sessionId: session.id as string,
  };
}
