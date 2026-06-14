const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export class GoogleOAuthError extends Error {
  constructor(
    message: string,
    public readonly upstreamStatus?: number,
    public readonly upstreamBody?: string,
  ) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

async function postToken(params: URLSearchParams): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!response.ok) {
    const body = await response.text();
    const truncatedBody = body.length > 500 ? `${body.slice(0, 500)}…` : body;
    throw new GoogleOAuthError(
      `Google token request failed (${response.status}): ${truncatedBody}`,
      response.status,
      body,
    );
  }
  return (await response.json()) as GoogleTokenResponse;
}

// clientId/clientSecret are explicit so callers can use scoped env vars
// (e.g. GMAIL_CLIENT_ID fallback to GOOGLE_CLIENT_ID) instead of one global pair.
export async function refreshGoogleToken(opts: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleTokenResponse> {
  return postToken(
    new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: opts.refreshToken,
      grant_type: "refresh_token",
    }),
  );
}

export async function exchangeGoogleCode(opts: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleTokenResponse> {
  return postToken(
    new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: "authorization_code",
    }),
  );
}

export function buildGoogleAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  accessType?: "offline" | "online";
  prompt?: "consent" | "select_account" | "none";
  loginHint?: string;
  includeGrantedScopes?: boolean;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scopes.join(" "),
    state: opts.state,
  });
  if (opts.accessType) params.set("access_type", opts.accessType);
  if (opts.prompt) params.set("prompt", opts.prompt);
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  if (opts.includeGrantedScopes) params.set("include_granted_scopes", "true");
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}
