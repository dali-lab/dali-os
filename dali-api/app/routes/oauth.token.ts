import type { Route } from "./+types/oauth.token";
import {
  exchangeAuthorizationCode,
  issueTokens,
  refreshTokens,
  OAuthError,
} from "~/lib/oauth";

import { setTokenCookies, parseRefreshToken } from "~/lib/cookies";
import type { UserInfo } from "~/lib/oauth";
import { withCors, handlePreflight, preflightLoader } from "~/lib/cors";

export const loader = preflightLoader;

async function parseBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    return request.json();
  }

  const formData = await request.formData();
  return Object.fromEntries(formData.entries()) as Record<string, string>;
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const body = await parseBody(request);
  const grantType = body.grant_type;

  try {
    if (grantType === "authorization_code") {
      const { code, code_verifier, redirect_uri, client_id } = body;
      if (!code || !code_verifier || !redirect_uri || !client_id) {
        throw new OAuthError("invalid_request", "Missing required parameters");
      }

      const { userId, provider, accountType } = await exchangeAuthorizationCode(
        {
          code,
          codeVerifier: code_verifier,
          redirectUri: redirect_uri,
          clientId: client_id,
        },
      );

      const authType =
        provider === "cas" ? "dartmouth" : (accountType ?? "member");
      const tokens = await issueTokens(userId, authType);

      return withCors(request, tokenResponse(tokens));
    }

    if (grantType === "refresh_token") {
      // read refresh token from cookie first, fall back to body
      const refreshToken = parseRefreshToken(request) ?? body.refresh_token;
      if (!refreshToken) {
        throw new OAuthError("invalid_request", "refresh_token is required");
      }

      const tokens = await refreshTokens(refreshToken);
      return withCors(request, tokenResponse(tokens));
    }

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

function tokenResponse(tokens: {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  userInfo: UserInfo;
}) {
  const res = Response.json(
    {
      access_token: tokens.access_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
      user: tokens.userInfo,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );

  setTokenCookies(res.headers, tokens.access_token, tokens.refresh_token);
  return res;
}
