import type { Route } from "./+types/oauth.token";
import {
  exchangeAuthorizationCode,
  buildUserInfo,
  getOAuthClient,
  OAuthError,
} from "~/lib/oauth";
import type { UserInfo } from "~/lib/oauth";

import { setSessionCookie } from "~/lib/cookies";
import { issueSession, ROLLING_TTL_MS } from "~/lib/session";
import { getClientIp } from "~/lib/request-meta";
import { withCors, handlePreflight, preflightLoader } from "~/lib/cors";
import { checkRateLimit } from "~/lib/rate-limit";
import { safeJson } from "~/lib/safe-json";
import { prisma } from "~/lib/db";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { mintBetterAuthSession } from "~/lib/betterauth-session.server";

const RATE_LIMIT_MAX = 200;
const RATE_LIMIT_WINDOW_MS = 60_000;

export const loader = preflightLoader;

async function parseBody(request: Request): Promise<Record<string, string> | Response> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    return safeJson<Record<string, string>>(request);
  }

  const formData = await request.formData();
  return Object.fromEntries(formData.entries()) as Record<string, string>;
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const rateLimited = checkRateLimit(request, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });
  if (rateLimited) return withCors(request, rateLimited);

  const body = await parseBody(request);
  if (body instanceof Response) return withCors(request, body);
  const grantType = body.grant_type;

  try {
    if (grantType === "authorization_code") {
      const { code, code_verifier, redirect_uri, client_id } = body;
      if (!code || !code_verifier || !redirect_uri || !client_id) {
        throw new OAuthError("invalid_request", "Missing required parameters");
      }

      const {
        userId,
        provider,
        accountType,
        scopes,
        clientId: resolvedClientId,
      } = await exchangeAuthorizationCode({
        code,
        codeVerifier: code_verifier,
        redirectUri: redirect_uri,
        clientId: client_id,
      });

      const authType =
        provider === "cas" ? "dartmouth" : (accountType ?? "member");

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new OAuthError("server_error", "User not found");

      // Upsert the OAuthGrant for (user, client). The set of scopes is the
      // union of any prior grant + this request's scopes — once a user has
      // approved a scope it persists until they revoke the grant.
      const client = await getOAuthClient(resolvedClientId);
      if (!client) throw new OAuthError("invalid_client", "Unknown client_id");

      const existingGrant = await prisma.oAuthGrant.findUnique({
        where: {
          userId_clientId: { userId, clientId: client.clientId },
        },
      });
      const nextScopes = Array.from(
        new Set([...(existingGrant?.scopes ?? []), ...scopes]),
      );
      const grant = await prisma.oAuthGrant.upsert({
        where: {
          userId_clientId: { userId, clientId: client.clientId },
        },
        update: {
          scopes: nextScopes,
          lastUsedAt: new Date(),
          revokedAt: null,
        },
        create: {
          userId,
          clientId: client.clientId,
          name: client.name,
          scopes: nextScopes,
          lastUsedAt: new Date(),
        },
      });

      const userInfo = buildUserInfo(user, authType);

      // Phase 4 (betterauth flag): mint a BetterAuth session so the token can
      // be verified by auth.api.getSession() in authenticateMcpRequest. When
      // the flag is off, fall through to the bespoke Session path unchanged.
      if (await isFeatureEnabledForEveryone("betterauth", request)) {
        const s = await mintBetterAuthSession({
          userId,
          grantId: grant.id,
          userAgent: request.headers.get("user-agent") ?? undefined,
          ipAddress: getClientIp(request),
        });
        return withCors(
          request,
          tokenResponse(s.token, s.expiresAt, userInfo, scopes),
        );
      }

      const session = await issueSession({
        userId,
        grantId: grant.id,
        userAgent: request.headers.get("user-agent") ?? undefined,
        ip: getClientIp(request),
      });

      return withCors(
        request,
        tokenResponse(session.rawId, new Date(Date.now() + ROLLING_TTL_MS), userInfo, scopes),
      );
    }

    // refresh_token grant intentionally removed. Sessions auto-extend on
    // use (rolling TTL); MCP clients re-run the authorization flow when
    // the bearer expires. See SESSION_AUTH_PLAN.md.

    throw new OAuthError(
      "unsupported_grant_type",
      `Unsupported grant_type: ${grantType}`,
    );
  } catch (err) {
    if (err instanceof OAuthError) {
      return withCors(request, Response.json(err.toJSON(), { status: 400 }));
    }
    throw err;
  }
}

function tokenResponse(rawSessionId: string, expiresAt: Date, userInfo: UserInfo, scopes: string[]) {
  const expiresIn = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const res = Response.json(
    {
      access_token: rawSessionId,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope: scopes.join(" "),
      user: userInfo,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );

  setSessionCookie(res.headers, rawSessionId);
  return res;
}
