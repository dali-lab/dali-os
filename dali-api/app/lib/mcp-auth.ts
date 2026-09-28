// MCP request authentication. Resolves the Bearer session, walks to the
// OAuthGrant + OAuthClient, re-runs the requireMembership gate, and bumps
// rolling expiry + lastUsedAt. Failure paths surface a 401 Response.
//
// Coexistence (Phase 4 / betterauth flag):
//   1. Legacy path (bespoke Session): always tried first. Unchanged.
//   2. BetterAuth path: tried only when (a) the legacy lookup finds no session
//      AND (b) the `betterauth` flag is enabled for everyone. A fault in the
//      BetterAuth path cannot break the legacy path — it is wrapped in try/catch.
//
// Both paths share the same downstream grant/membership validation via
// `verifyGrantAndMembership()` to avoid duplication.

import { parseSessionId } from "~/lib/cookies";
import { lookupSession, rollSession } from "~/lib/session";
import { prisma } from "~/lib/db";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { auth } from "~/lib/betterauth.server";

export type McpAuthSuccess = {
  ok: true;
  user: {
    id: string;
    daliEmail: string | null;
    dartmouthEmail: string | null;
    netId: string | null;
    firstName: string;
    lastName: string;
  };
  scopes: string[];
  grantId: string;
  clientId: string;
  clientName: string;
};

export type McpAuthFailure = {
  ok: false;
  response: Response;
};

export type McpAuthResult = McpAuthSuccess | McpAuthFailure;

function unauthorized(reason: string): Response {
  const issuer = process.env.API_BASE_URL;
  const resourceMetadata = issuer
    ? `, resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"`
    : "";
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message: `Unauthorized: ${reason}` }, id: null },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer realm="dali-os-mcp", error="${reason}"${resourceMetadata}`,
      },
    },
  );
}

// Shared grant + membership validation. Used by both the legacy and BetterAuth
// paths so the logic lives in exactly one place.
type GrantCheckUser = {
  id: string;
  daliEmail: string | null;
  dartmouthEmail: string | null;
  netId: string | null;
  firstName: string;
  lastName: string;
};

async function verifyGrantAndMembership(
  grantId: string,
  user: GrantCheckUser,
): Promise<McpAuthResult> {
  const grant = await prisma.oAuthGrant.findUnique({
    where: { id: grantId },
    include: { client: true },
  });
  if (!grant || grant.revokedAt) {
    return { ok: false, response: unauthorized("grant_revoked") };
  }

  // Re-check requireMembership at every request. This is the off-boarding
  // kill switch — a removed member's MCP access dies on the next call even
  // if the bearer hasn't expired.
  if (grant.client.requireMembership) {
    const member = await prisma.dALIMember.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!member) {
      return { ok: false, response: unauthorized("not_a_member") };
    }
  }

  // Fire-and-forget: bump grant.lastUsedAt. A failure doesn't break this request.
  prisma.oAuthGrant
    .update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    ok: true,
    user,
    scopes: grant.scopes,
    grantId: grant.id,
    clientId: grant.clientId,
    clientName: grant.client.name,
  };
}

export async function authenticateMcpRequest(
  request: Request,
): Promise<McpAuthResult> {
  const raw = parseSessionId(request);
  if (!raw) return { ok: false, response: unauthorized("missing_token") };

  // ── Legacy path (bespoke Session) ────────────────────────────────────────
  // Always tried first. When the flag is off this is the only path.
  const session = await lookupSession(raw);
  if (session) {
    if (session.revokedAt) {
      return { ok: false, response: unauthorized("revoked") };
    }
    const now = new Date();
    if (session.expiresAt < now || session.absoluteExpiresAt < now) {
      return { ok: false, response: unauthorized("expired") };
    }

    // Only OAuth-issued (grant-backed) sessions are valid MCP credentials.
    if (!session.grantId) {
      return { ok: false, response: unauthorized("not_an_mcp_session") };
    }

    // Fire-and-forget rolling expiry update.
    rollSession(session).catch(() => {});

    return verifyGrantAndMembership(session.grantId, session.user);
  }

  // ── BetterAuth path ───────────────────────────────────────────────────────
  // Only consulted when: (a) legacy lookup found no session AND (b) the flag
  // is enabled. Faults here cannot affect the already-resolved legacy result.
  if (!(await isFeatureEnabledForEveryone("betterauth", request))) {
    // Flag off — treat as unknown token (same as legacy "no session" before).
    return { ok: false, response: unauthorized("invalid_token") };
  }

  try {
    const baSession = await auth.api.getSession({ headers: request.headers });
    if (!baSession) {
      return { ok: false, response: unauthorized("invalid_token") };
    }

    // BetterAuth's TypeScript types don't surface additionalFields yet, so we
    // narrow-cast. `grantId` is declared in betterauth.server.ts session block.
    const rawSession = baSession.session as Record<string, unknown>;
    const grantId = typeof rawSession.grantId === "string" ? rawSession.grantId : null;

    if (!grantId) {
      // BetterAuth session exists but has no grantId — it's a browser login
      // session, not an MCP token.
      return { ok: false, response: unauthorized("not_an_mcp_session") };
    }

    const baUser = baSession.user as {
      id: string;
      daliEmail?: string | null;
      dartmouthEmail?: string | null;
      netId?: string | null;
      firstName?: string | null;
      lastName?: string | null;
    };

    const user: GrantCheckUser = {
      id: baUser.id,
      daliEmail: baUser.daliEmail ?? null,
      dartmouthEmail: baUser.dartmouthEmail ?? null,
      netId: baUser.netId ?? null,
      firstName: baUser.firstName ?? "",
      lastName: baUser.lastName ?? "",
    };

    return verifyGrantAndMembership(grantId, user);
  } catch (err) {
    // A BetterAuth fault (e.g. DB hiccup, adapter error) must not surface as a
    // 500 — return 401 so the MCP client retries the auth flow.
    console.error("[mcp-auth] BetterAuth session resolution failed", err);
    return { ok: false, response: unauthorized("invalid_token") };
  }
}
