// MCP request authentication. Resolves the Bearer session, walks to the
// OAuthGrant + OAuthClient, re-runs the requireMembership gate, and bumps
// rolling expiry + lastUsedAt. Failure paths surface a 401 Response.

import { parseSessionId } from "~/lib/cookies";
import { lookupSession, rollSession } from "~/lib/session";
import { prisma } from "~/lib/db";

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

export async function authenticateMcpRequest(
  request: Request,
): Promise<McpAuthResult> {
  const raw = parseSessionId(request);
  if (!raw) return { ok: false, response: unauthorized("missing_token") };

  const session = await lookupSession(raw);
  if (!session) return { ok: false, response: unauthorized("invalid_token") };
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

  const grant = await prisma.oAuthGrant.findUnique({
    where: { id: session.grantId },
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
      where: { userId: session.userId },
      select: { id: true },
    });
    if (!member) {
      return { ok: false, response: unauthorized("not_a_member") };
    }
  }

  // Fire-and-forget. A roll/lastUsedAt failure doesn't break this request.
  rollSession(session).catch(() => {});
  prisma.oAuthGrant
    .update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    ok: true,
    user: session.user,
    scopes: grant.scopes,
    grantId: grant.id,
    clientId: grant.clientId,
    clientName: grant.client.name,
  };
}
