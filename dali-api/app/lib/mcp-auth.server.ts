import { parseBearerHeader } from "~/lib/cookies";
import { prisma } from "~/lib/db.server";
import { auth } from "~/lib/betterauth.server";
import { getEnv } from "~/lib/env.server";

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
  const issuer = getEnv().API_BASE_URL;
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
  if (!parseBearerHeader(request)) return { ok: false, response: unauthorized("missing_token") };

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
