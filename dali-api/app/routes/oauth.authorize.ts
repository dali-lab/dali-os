import type { Route } from "./+types/oauth.authorize";
import {
  createOAuthSession,
  getAllowedRedirectUris,
  VALID_CLIENT_IDS,
  OAuthError,
} from "~/lib/oauth";

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";

  function errorRedirect(error: string, description: string) {
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    const target =
      redirectUri && getAllowedRedirectUris().includes(redirectUri)
        ? redirectUri
        : `${frontendUrl}/login`;
    const params = new URLSearchParams({
      error,
      error_description: description,
    });
    if (state) params.set("state", state);
    return new Response(null, {
      status: 302,
      headers: { Location: `${target}?${params}` },
    });
  }

  // valitate required query parameters
  const responseType = url.searchParams.get("response_type");
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");
  const provider = url.searchParams.get("provider");
  const accountType = url.searchParams.get("account_type");

  if (responseType !== "code") {
    return errorRedirect(
      "unsupported_response_type",
      "response_type must be 'code'",
    );
  }
  if (!clientId || !VALID_CLIENT_IDS.includes(clientId as any)) {
    return errorRedirect("invalid_client", "Unknown client_id");
  }
  if (!redirectUri || !getAllowedRedirectUris().includes(redirectUri)) {
    return new Response("Invalid redirect_uri", { status: 400 });
  }
  if (!state) {
    return errorRedirect("invalid_request", "state is required");
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return errorRedirect(
      "invalid_request",
      "code_challenge with method S256 is required",
    );
  }
  if (!provider || !["google", "cas"].includes(provider)) {
    return errorRedirect(
      "invalid_request",
      "provider must be 'google' or 'cas'",
    );
  }

  const session = await createOAuthSession({
    codeChallenge,
    codeChallengeMethod,
    redirectUri,
    state,
    provider,
    accountType: accountType ?? undefined,
  });

  const apiBase = process.env.API_BASE_URL ?? "http://localhost:3001";

  // Dartmouth CAS authentication flow
  // redirect to CAS login with service URL pointing to callback endpoint
  if (provider === "cas") {
    const casBase =
      process.env.CAS_BASE_URL ?? "https://login.dartmouth.edu/cas";
    const serviceUrl = `${apiBase}/oauth/callback/cas?session_id=${session.id}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${casBase}/login?service=${encodeURIComponent(serviceUrl)}`,
      },
    });
  }

  // Google authentication flow
  // redirect to google oauth with redirect_uri pointing to callback endpoint
  const googleParams = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${apiBase}/oauth/callback/google`,
    response_type: "code",
    scope: "openid email profile https://www.googleapis.com/auth/calendar.readonly",
    state: session.id,
    access_type: "offline",
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
