import type { Route } from "./+types/oauth.authorize";
import {
  createOAuthSession,
  generateAuthorizationCode,
  getOAuthClient,
  isAllowedRedirectUri,
  OAuthError,
} from "~/lib/oauth";
import { checkRateLimit } from "~/lib/rate-limit";
import { parseSessionId } from "~/lib/cookies";
import { lookupSession } from "~/lib/session";
import { prisma } from "~/lib/db";
import type { OAuthAccountType, OAuthProvider } from "~/generated/prisma/enums";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}

export async function loader({ request }: Route.LoaderArgs) {
  const limited = checkRateLimit(request, {
    max: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (limited) return limited;

  const url = new URL(request.url);

  function fallbackError(error: string, description: string) {
    const params = new URLSearchParams({ error, error_description: description });
    return new Response(null, {
      status: 302,
      headers: { Location: `/login?${params}` },
    });
  }
  function clientError(
    redirectUri: string,
    state: string | null,
    error: string,
    description: string,
  ) {
    const params = new URLSearchParams({ error, error_description: description });
    if (state) params.set("state", state);
    return new Response(null, {
      status: 302,
      headers: { Location: `${redirectUri}?${params}` },
    });
  }

  // validate required query parameters
  const responseType = url.searchParams.get("response_type");
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");
  const providerParam = url.searchParams.get("provider");
  const accountTypeParam = url.searchParams.get("account_type");
  const scopeParam = url.searchParams.get("scope");

  if (!clientId) {
    return fallbackError("invalid_client", "client_id is required");
  }
  const client = await getOAuthClient(clientId);
  if (!client) {
    return fallbackError("invalid_client", "Unknown client_id");
  }
  if (!redirectUri || !isAllowedRedirectUri(client, redirectUri)) {
    // RFC 6749 §3.1.2.4: never redirect to an untrusted URI on bad redirect.
    return new Response("Invalid redirect_uri", { status: 400 });
  }
  if (responseType !== "code") {
    return clientError(
      redirectUri,
      state,
      "unsupported_response_type",
      "response_type must be 'code'",
    );
  }
  if (!state) {
    return clientError(redirectUri, null, "invalid_request", "state is required");
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return clientError(
      redirectUri,
      state,
      "invalid_request",
      "code_challenge with method S256 is required",
    );
  }

  // Provider must be one of the client's allowedProviders. For MCP clients
  // this filters CAS out at the gate; only "google" survives.
  const provider = providerParam ?? client.allowedProviders[0];
  if (!provider || !client.allowedProviders.includes(provider)) {
    return clientError(
      redirectUri,
      state,
      "invalid_request",
      "provider is not allowed for this client",
    );
  }

  // accountType: pinned by the client if requiredAccountType is set; the
  // query-param value (if any) must match. Otherwise the param flows through.
  let accountType: OAuthAccountType | undefined;
  if (client.requiredAccountType) {
    if (accountTypeParam && accountTypeParam !== client.requiredAccountType) {
      return clientError(
        redirectUri,
        state,
        "invalid_request",
        "account_type does not match client requirement",
      );
    }
    accountType = client.requiredAccountType as OAuthAccountType;
  } else if (accountTypeParam) {
    accountType = accountTypeParam as OAuthAccountType;
  }

  // Scopes: space-delimited per RFC 6749 §3.3. Must all be in allowedScopes.
  const requestedScopes = scopeParam
    ? scopeParam.split(/\s+/).filter(Boolean)
    : [];
  for (const s of requestedScopes) {
    if (!client.allowedScopes.includes(s)) {
      return clientError(redirectUri, state, "invalid_scope", `scope not allowed: ${s}`);
    }
  }

  const oauthSession = await createOAuthSession({
    codeChallenge,
    codeChallengeMethod,
    redirectUri,
    state,
    provider: provider as OAuthProvider,
    accountType,
    clientId: client.clientId,
    scopes: requestedScopes,
  });

  const apiBase = process.env.API_BASE_URL ?? "http://localhost:5173";

  // ── Existing-session shortcut ────────────────────────────────────────────
  // If the browser already has a valid first-party cookie session, skip
  // the IDP redirect entirely. The OAuthClient policy is re-applied here:
  // we re-check membership when client.requireMembership is true.
  const rawSid = parseSessionId(request);
  if (rawSid) {
    const existing = await lookupSession(rawSid);
    const now = new Date();
    if (
      existing &&
      !existing.revokedAt &&
      existing.expiresAt > now &&
      existing.absoluteExpiresAt > now
    ) {
      if (client.requireMembership) {
        const member = await prisma.dALIMember.findUnique({
          where: { userId: existing.userId },
          select: { id: true },
        });
        if (!member) {
          return clientError(
            redirectUri,
            state,
            "access_denied",
            "not_a_member",
          );
        }
      }
      // For a member with daliEmail set, only `member` accountType is valid.
      // We trust the cookie session and skip the IDP. Branch to consent
      // (or straight to code-issue if a matching grant already exists).
      const existingGrant = client.isFirstParty
        ? null
        : await prisma.oAuthGrant.findUnique({
            where: {
              userId_clientId: { userId: existing.userId, clientId: client.clientId },
            },
          });
      const matchingGrant =
        existingGrant &&
        !existingGrant.revokedAt &&
        requestedScopes.every((s) => existingGrant.scopes.includes(s));

      if (client.isFirstParty || matchingGrant) {
        const code = await generateAuthorizationCode(
          oauthSession.id,
          existing.userId,
        );
        const params = new URLSearchParams({ code, state });
        return new Response(null, {
          status: 302,
          headers: { Location: `${redirectUri}?${params}` },
        });
      }

      // No matching grant — pre-set userId so the consent screen can show it.
      await prisma.oAuthSession.update({
        where: { id: oauthSession.id },
        data: { userId: existing.userId },
      });
      // Consent route lives on the same origin as /oauth/authorize (the
      // dali-api full-stack app); use a same-origin path so it works both
      // locally (no separate frontend bind) and in production.
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/oauth/consent?session_id=${oauthSession.id}`,
        },
      });
    }
  }

  // ── CAS flow ─────────────────────────────────────────────────────────────
  if (provider === "cas") {
    const casBase =
      process.env.CAS_BASE_URL ?? "https://login.dartmouth.edu/cas";
    const serviceUrl = `${apiBase}/oauth/callback/cas?session_id=${oauthSession.id}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${casBase}/login?service=${encodeURIComponent(serviceUrl)}`,
      },
    });
  }

  // ── Google flow ──────────────────────────────────────────────────────────
  const googleParams = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${apiBase}/oauth/callback/google`,
    response_type: "code",
    scope: "openid email profile",
    state: oauthSession.id,
    prompt: "select_account",
  });
  if (accountType === "member") {
    googleParams.set("hd", "dali.dartmouth.edu");
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${googleParams}`,
    },
  });
}
