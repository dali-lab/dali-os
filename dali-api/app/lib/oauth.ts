import { createHash, randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "~/lib/db";

// types

export interface UserInfo {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  type: string;
}

export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }

  toJSON() {
    return { error: this.code, error_description: this.message };
  }
}

// constants - these were all chosen based on relevant rfc, can be tuned as needed

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 min for the authorize→callback→exchange round-trip
const AUTH_CODE_TTL_MS = 60 * 1000; // 1 min for code→token exchange

export const VALID_CLIENT_IDS = ["dali-api"] as const;

const frontendUrl = () => process.env.FRONTEND_URL ?? "http://localhost:5173";

export function getAllowedRedirectUris() {
  return [`${frontendUrl()}/login`];
}

// helper functions

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}

function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function deriveAuthType(user: {
  daliEmail: string | null;
  netId: string | null;
}): string {
  if (user.daliEmail) return "member";
  if (user.netId) return "dartmouth";
  return "partner";
}

export function buildUserInfo(
  user: {
    id: string;
    daliEmail: string | null;
    dartmouthEmail: string | null;
    netId: string | null;
    firstName: string;
    lastName: string;
  },
  authType?: string,
): UserInfo {
  const resolvedType = authType ?? deriveAuthType(user);
  return {
    id: user.id,
    email:
      user.daliEmail ?? user.dartmouthEmail ?? `${user.netId}@dartmouth.edu`,
    firstName: user.firstName,
    lastName: user.lastName,
    type: resolvedType,
  };
}

// PKCE verification

export function verifyPKCE(
  codeVerifier: string,
  codeChallenge: string,
  method: string,
): boolean {
  if (method !== "S256") return false;
  return sha256(codeVerifier) === codeChallenge;
}

// OAuth sessions

export async function createOAuthSession(params: {
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  state: string;
  provider: string;
  accountType?: string;
}) {
  return prisma.oAuthSession.create({
    data: {
      ...params,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
}

export async function getOAuthSession(id: string) {
  return prisma.oAuthSession.findUnique({ where: { id } });
}

// authorization codes

export async function generateAuthorizationCode(
  sessionId: string,
  userId: string,
): Promise<string> {
  const code = generateOpaqueToken();
  await prisma.oAuthSession.update({
    where: { id: sessionId },
    data: {
      userId,
      authorizationCode: code,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  });
  return code;
}

export async function exchangeAuthorizationCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
}) {
  const session = await prisma.oAuthSession.findUnique({
    where: { authorizationCode: params.code },
  });

  if (!session)
    throw new OAuthError("invalid_grant", "Invalid authorization code");
  if (session.exchanged)
    throw new OAuthError("invalid_grant", "Authorization code already used");
  if (session.expiresAt < new Date())
    throw new OAuthError("invalid_grant", "Authorization code expired");
  if (session.redirectUri !== params.redirectUri)
    throw new OAuthError("invalid_grant", "redirect_uri mismatch");
  if (!VALID_CLIENT_IDS.includes(params.clientId as any))
    throw new OAuthError("invalid_client", "Unknown client_id");

  if (
    !verifyPKCE(
      params.codeVerifier,
      session.codeChallenge,
      session.codeChallengeMethod,
    )
  ) {
    throw new OAuthError("invalid_grant", "PKCE verification failed");
  }

  await prisma.oAuthSession.update({
    where: { id: session.id },
    data: { exchanged: true },
  });

  if (!session.userId)
    throw new OAuthError("server_error", "Session has no user");

  return {
    userId: session.userId,
    provider: session.provider,
    accountType: session.accountType,
  };
}

// Token issuing now lives in `lib/session.ts` (`issueSession`). The OAuth
// provider's `/oauth/token` endpoint calls `issueSession` after
// `exchangeAuthorizationCode` succeeds. Refresh-token grant has been removed
// from `/oauth/token` — sessions auto-extend on use. See SESSION_AUTH_PLAN.md.

// google OAuth

export async function exchangeGoogleCode(code: string, callbackUrl: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: callbackUrl,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new OAuthError(
      "server_error",
      `Google token exchange failed: ${err}`,
    );
  }

  const data = await res.json();
  const idToken = data.id_token as string;

  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID!,
  });
  const payload = ticket.getPayload();
  if (!payload) {
    throw new OAuthError("server_error", "Failed to verify Google ID token");
  }
  if (!payload.email || !payload.email_verified) {
    throw new OAuthError("server_error", "Email not verified by Google");
  }

  return {
    email: payload.email,
    firstName: (payload.given_name ?? "") as string,
    lastName: (payload.family_name ?? "") as string,
    accessToken: data.access_token as string | undefined,
    refreshToken: data.refresh_token as string | undefined,
    expiresIn: data.expires_in as number | undefined,
  };
}
