// MCP request authentication. Resolves the Bearer session, walks to the
// OAuthGrant + OAuthClient, re-runs the requireMembership gate, and bumps
// rolling expiry + lastUsedAt. Failure paths surface a 401 Response.
//
// Legacy sessions are tried first (and bridged to BetterAuth, see
// bridgeLegacyToken), then BetterAuth. A fault in the BetterAuth path cannot
// break the legacy path — it is wrapped in try/catch.
//
// Both paths share the same downstream grant/membership validation via
// `verifyGrantAndMembership()` to avoid duplication.

import { parseSessionId } from "~/lib/cookies";
import { lookupSession, rollSession } from "~/lib/session";
import { prisma } from "~/lib/db";
import { auth } from "~/lib/betterauth.server";
import { mintBetterAuthSession } from "~/lib/betterauth-session.server";
import { getClientIp } from "~/lib/rate-limit";

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

// TEMPORARY — delete with the legacy branch above once no legacy MCP session is
// left (see specs/betterauth-legacy-auth-cleanup.md, Phase 4).
//
// MCP clients have no refresh grant, so they can't be handed a new token. The
// session moves to BetterAuth under the SAME token string instead: the client
// keeps working without reconnecting, and the legacy row is deleted so the next
// request resolves through BetterAuth.
async function bridgeLegacyToken(
  raw: string,
  session: { id: string; userId: string; grantId: string | null },
  request: Request,
): Promise<boolean> {
  try {
    if (!session.grantId) return false;
    const existing = await prisma.authSession.findUnique({
      where: { token: raw },
      select: { id: true },
    });
    if (!existing) {
      await mintBetterAuthSession({
        userId: session.userId,
        grantId: session.grantId,
        token: raw,
        ipAddress: getClientIp(request),
        userAgent: request.headers.get("user-agent") ?? undefined,
      });
    }
    await prisma.session.deleteMany({ where: { id: session.id } });
    return true;
  } catch (err) {
    // The request is already authorized by the legacy session; a failed bridge
    // just leaves that session in place for the next request to retry.
    console.error(
      "[mcp-auth] legacy token bridge failed:",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
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

    const result = await verifyGrantAndMembership(session.grantId, session.user);
    if (result.ok && !(await bridgeLegacyToken(raw, session, request))) {
      rollSession(session).catch(() => {});
    }
    return result;
  }

  // ── BetterAuth path ───────────────────────────────────────────────────────
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
