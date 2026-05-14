import type { Route } from "./+types/oauth.token";
import {
  exchangeAuthorizationCode,
  buildUserInfo,
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

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new OAuthError("server_error", "User not found");

      const session = await issueSession({
        userId,
        userAgent: request.headers.get("user-agent") ?? undefined,
        ip: getClientIp(request),
        // grantId plumbed through when OAuthGrant lands; for now sessions
        // issued via the OAuth flow are not yet attributed to a grant row.
      });

      const userInfo = buildUserInfo(user, authType);

      return withCors(
        request,
        tokenResponse(session.rawId, userInfo),
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

function tokenResponse(rawSessionId: string, userInfo: UserInfo) {
  const expiresIn = Math.floor(ROLLING_TTL_MS / 1000);
  const res = Response.json(
    {
      access_token: rawSessionId,
      token_type: "Bearer",
      expires_in: expiresIn,
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
