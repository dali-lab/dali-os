import { createHash, randomBytes } from "node:crypto";
import { prisma } from "~/lib/db";
import { signAccessToken } from "~/lib/auth";

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
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ACCESS_TOKEN_EXPIRES_IN = 900; // 15 min

export const VALID_CLIENT_IDS = ["dali-web"] as const;

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

function buildUserInfo(
  user: {
    id: string;
    daliEmail: string | null;
    dartmouthEmail: string | null;
    netId: string | null;
    firstName: string;
    lastName: string;
  },
  authType: string,
): UserInfo {
  return {
    id: user.id,
    email:
      user.daliEmail ?? user.dartmouthEmail ?? `${user.netId}@dartmouth.edu`,
    firstName: user.firstName,
    lastName: user.lastName,
    type: authType,
  };
}

async function createTokenPair(
  user: {
    id: string;
    daliEmail: string | null;
    dartmouthEmail: string | null;
    netId: string | null;
    firstName: string;
    lastName: string;
  },
  authType: string,
  family?: string,
) {
  const userInfo = buildUserInfo(user, authType);

  const accessToken = await signAccessToken({
    sub: user.id,
    email: userInfo.email,
    type: authType,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  const rawRefreshToken = generateOpaqueToken();

  await prisma.refreshToken.create({
    data: {
      tokenHash: sha256(rawRefreshToken),
      userId: user.id,
      family: family ?? generateOpaqueToken(),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  return {
    access_token: accessToken,
    token_type: "Bearer" as const,
    expires_in: ACCESS_TOKEN_EXPIRES_IN,
    refresh_token: rawRefreshToken,
    userInfo,
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

// token issuing and refreshing

export async function issueTokens(userId: string, authType: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new OAuthError("server_error", "User not found");
  return createTokenPair(user, authType);
}

export async function refreshTokens(rawRefreshToken: string) {
  const tokenHash = sha256(rawRefreshToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
  });

  if (!existing) throw new OAuthError("invalid_grant", "Invalid refresh token");

  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { family: existing.family },
      data: { revokedAt: new Date() },
    });
    throw new OAuthError(
      "invalid_grant",
      "Refresh token reuse detected — family revoked",
    );
  }

  if (existing.expiresAt < new Date()) {
    throw new OAuthError("invalid_grant", "Refresh token expired");
  }

  // revoke old token
  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });

  const user = await prisma.user.findUnique({
    where: { id: existing.userId },
  });
  if (!user) throw new OAuthError("server_error", "User not found");

  return createTokenPair(user, deriveAuthType(user), existing.family);
}

// revoke tokens

export async function revokeToken(rawToken: string) {
  const tokenHash = sha256(rawToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
  });
  if (!existing) return;

  await prisma.refreshToken.updateMany({
    where: { family: existing.family },
    data: { revokedAt: new Date() },
  });
}

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

  // decode the id_token payload (already verified by Google)
  const payload = JSON.parse(
    Buffer.from(idToken.split(".")[1], "base64url").toString(),
  );

  return {
    email: payload.email as string,
    firstName: (payload.given_name ?? "") as string,
    lastName: (payload.family_name ?? "") as string,
  };
}
