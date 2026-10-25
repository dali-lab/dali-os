import type { Route } from "./+types/oauth.authorize";
import {
  authorizationResponseUrl,
  createOAuthSession,
  generateAuthorizationCode,
  getOAuthClient,
  isAllowedRedirectUri,
} from "~/lib/oauth";
import { checkRateLimit } from "~/lib/rate-limit";
import { isImpersonating, requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import type { OAuthAccountType, OAuthProvider } from "~/generated/prisma/enums";
import { getOAuthIssuer } from "~/lib/app-env";

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
  const issuer = getOAuthIssuer(request);

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
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorizationResponseUrl({
          issuer,
          redirectUri,
          query: { error, error_description: description, state },
        }),
      },
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

  // Provider must be one of the client's allowedProviders. It no longer picks
  // how the user signs in (that's /login); it is only recorded on the session.
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

  // Scopes: space-delimited per RFC 6749 §3.3. Must all be in allowedScopes —
  // except mcp:admin, which is optional. Clients registered before it existed
  // don't allow it, yet ask for it now that the metadata advertises it; drop
  // it for them (as consent drops it for non-Core users) rather than failing
  // the whole authorization.
  const requestedScopes = (scopeParam ? scopeParam.split(/\s+/).filter(Boolean) : []).filter(
    (s) => s !== "mcp:admin" || client.allowedScopes.includes(s),
  );
  for (const s of requestedScopes) {
    if (!client.allowedScopes.includes(s)) {
      return clientError(redirectUri, state, "invalid_scope", `scope not allowed: ${s}`);
    }
  }

  // Sign-in happens on /login (BetterAuth), which returns here afterwards. An
  // admin impersonating a member must not authorize a client as that member.
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (isImpersonating(auth)) {
    return clientError(redirectUri, state, "access_denied", "impersonating");
  }
  const userId = auth.user.sub;

  if (client.requireMembership) {
    const member = await prisma.dALIMember.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!member) {
      return clientError(redirectUri, state, "access_denied", "not_a_member");
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

  const existingGrant = client.isFirstParty
    ? null
    : await prisma.oAuthGrant.findUnique({
        where: { userId_clientId: { userId, clientId: client.clientId } },
      });
  const matchingGrant =
    existingGrant &&
    !existingGrant.revokedAt &&
    requestedScopes.every((s) => existingGrant.scopes.includes(s));

  if (client.isFirstParty || matchingGrant) {
    const code = await generateAuthorizationCode(oauthSession.id, userId);
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorizationResponseUrl({
          issuer,
          redirectUri,
          query: { code, state },
        }),
      },
    });
  }

  // No matching grant: pre-set userId so the consent screen can show it.
  await prisma.oAuthSession.update({
    where: { id: oauthSession.id },
    data: { userId },
  });
  return new Response(null, {
    status: 302,
    headers: { Location: `/oauth/consent?session_id=${oauthSession.id}` },
  });
}
